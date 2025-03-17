import React, { useEffect, useRef, useState } from 'react';
import { Chessground } from 'chessground';
import { Api } from 'chessground/api';
import { Config } from 'chessground/config';
import { Chess, Square } from 'chess.js';
import { Color, Key } from 'chessground/types';
import { gameApi } from '../lib/api';

// Update the custom type definition to handle null ref
declare module 'chessground' {
  export function Chessground(element: HTMLElement, config?: any): Api;
}

interface ChessboardProps {
  fen?: string;
  orientation?: Color;
  playerSide?: Color; // Side that the human player plays as
  viewOnly?: boolean;
  onMove?: (from: string, to: string) => void;
  highlightSquares?: string[];
  skillLevel?: number;
}

function Chessboard({
  fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', // Default starting position
  orientation = 'white',
  playerSide = 'white', // Default player side is white
  viewOnly = false,
  onMove,
  highlightSquares = [],
  skillLevel = 10,
}: ChessboardProps) {
  // DOM reference for chessground
  const boardRef = useRef<HTMLElement | null>(null);
  
  // Store chessground instance in a ref to avoid rerendering
  const chessgroundRef = useRef<Api | null>(null);
  
  // Store chess.js instance in a ref - using version 1.1.0
  // Create a stable ref that won't change with renders
  const chessRef = useRef<any>(null);
  
  // Track loading state for the thinking indicator
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Flag to track if the board has been initialized
  const hasInitializedRef = useRef(false);
  
  // Flag to track if evaluation has been initialized
  const hasInitializedEvaluationRef = useRef(false);
  
  // Store current FEN and orientation in refs to track changes
  const currentFenRef = useRef(fen);
  const currentOrientationRef = useRef(orientation);
  
  // Keep track of the previous playerSide to detect changes
  const previousPlayerSideRef = useRef(playerSide);
  
  // Track position evaluation before player's move
  const previousEvalRef = useRef<number | null>(null);
  const currentEvalRef = useRef<number | null>(null);
  
  // Utility to safely update evaluation references
  const updateEvaluation = async (fen: string, target: { current: number | null }) => {
    if (!fen) {
      console.error("Cannot update evaluation: FEN is null or empty");
      target.current = 0;
      return 0;
    }
    
    try {
      const eval_score = await evaluatePosition(fen);
      
      if (eval_score !== null) {
        // Make sure we have a finite number
        const safeScore = isFinite(eval_score) ? eval_score : 0;
        target.current = safeScore;
        return safeScore;
      } else {
        console.error("Evaluation returned null or undefined");
        target.current = 0;
        return 0;
      }
    } catch (error) {
      console.error("Error updating evaluation:", error);
      // Set a safe default
      target.current = 0;
      return 0;
    }
  };
  
  // Function to calculate legal moves for the current position
  function calculateDests() {
    const dests = new Map();
    
    if (!chessRef.current) {
      console.error("Chess instance is null in calculateDests");
      return dests;
    }
    
    try {
      const chess = chessRef.current;
      
      // Get all possible moves
      const moves = chess.moves({ verbose: true });
      
      if (!moves) {
        console.error("Unable to get moves from chess instance");
        return dests;
      }
      
      // Group moves by source square
      for (const move of moves) {
        if (!dests.has(move.from)) {
          dests.set(move.from, []);
        }
        dests.get(move.from).push(move.to);
      }
    } catch (error: any) {
      console.error("Error calculating legal moves:", error);
    }
    return dests;
  }
  
  // Function to evaluate the current position
  async function evaluatePosition(fen: string) {
    try {
      const response = await gameApi.evaluatePosition(fen, 12); // Use standard depth of 12
      
      // The API returns 'evaluation', not 'score'
      const score = response.evaluation;
      
      // Validate that score is a number
      if (score === undefined || score === null || isNaN(score)) {
        console.error("Invalid score from evaluation:", score);
        return 0; // Return a safe default
      }
      
      // Get the current turn from the FEN string
      const turn = fen.split(' ')[1]; // 'w' for white, 'b' for black
      
      // Normalize the score from the engine's perspective
      // Engine always returns positive scores as good for the side to move
      // We want to normalize to white's perspective: positive = good for white
      return turn === 'b' ? -score : score;
    } catch (error) {
      console.error("Error evaluating position:", error);
      return 0; // Return 0 instead of null to avoid NaN in calculations
    }
  }
  
  // Function to make a Stockfish move
  async function makeStockfishMove() {
    // Skip if no chessground or processing another move
    if (!chessgroundRef.current || isProcessing) return;
    
    try {
      setIsProcessing(true);
      
      // Ensure chess instance exists
      if (!chessRef.current) {
        console.error("Chess instance is null in makeStockfishMove");
        setIsProcessing(false);
        return;
      }
      
      const chess = chessRef.current;
      
      // Safely get current FEN
      let currentFen;
      try {
        currentFen = chess.fen();
      } catch (error) {
        console.error("Error getting FEN:", error);
        setIsProcessing(false);
        return;
      }
      
      console.log(`Making Stockfish move with playerSide=${playerSide}, FEN=${currentFen}`);
      
      // Safely get legal moves
      let legalMoves;
      try {
        legalMoves = chess.moves({ verbose: true });
      } catch (error) {
        console.error("Error getting legal moves:", error);
        setIsProcessing(false);
        return;
      }
      
      if (!legalMoves || legalMoves.length === 0) {
        console.log("No legal moves available");
        setIsProcessing(false);
        return;
      }
      
      // The actual move to be played
      let moveFrom = '';
      let moveTo = '';
      let movePromotion = 'q'; // Default to queen promotion
      
      // Try to get a move from the API with error handling
      try {
        // Calculate evaluation change if player is playing as black
        // This means the computer (white) should use even-move
        let response;
        const isStartingPosition = currentFen.includes('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w');
        
        if (playerSide === 'black') {
          // Get the evaluation change from the previous position to current position
          // This indicates how the player's move changed the evaluation
          const evalChange = (previousEvalRef.current !== null && currentEvalRef.current !== null) 
            ? currentEvalRef.current - previousEvalRef.current 
            : 0;
          
          if (isStartingPosition) {
            console.log("Using even-move API for white's first move with evalChange=0");
          } else {
            console.log(`Using even-move API with evalChange=${evalChange}`);
          }
          
          // Store current evaluation as previous for next move
          previousEvalRef.current = currentEvalRef.current;
          
          // Use the even-move endpoint for adaptive learning when player is black
          // For first move as white, the evalChange will be 0
          response = await gameApi.getEvenMove(currentFen, evalChange, skillLevel);
        } else {
          console.log(`Using regular getBestMove API with skillLevel=${skillLevel}`);
          // Regular best move when player is white
          response = await gameApi.getBestMove(currentFen, skillLevel);
        }
        
        console.log("API response:", response);
        
        if (response && response.move && response.move.length >= 4) {
          moveFrom = response.move.substring(0, 2);
          moveTo = response.move.substring(2, 4);
          if (response.move.length > 4) {
            movePromotion = response.move[4];
          }
          
          console.log(`API suggested move: ${moveFrom}${moveTo}${movePromotion !== 'q' ? movePromotion : ''}`);
          
          // If using even-move, also update the evaluation
          if (playerSide === 'black' && response.evaluation !== undefined) {
            // Store this as the new evaluation for the next move comparison
            console.log(`Updating evaluation to ${response.evaluation}`);
            currentEvalRef.current = response.evaluation;
          }
        } else {
          throw new Error("Invalid response from API");
        }
      } catch (apiError) {
        console.error("API error, using random move:", apiError);
        // Pick a random legal move as fallback
        const randomIndex = Math.floor(Math.random() * legalMoves.length);
        const randomMove = legalMoves[randomIndex];
        moveFrom = randomMove.from;
        moveTo = randomMove.to;
        console.log(`Using random fallback move: ${moveFrom}${moveTo}`);
      }
      
      // Double-check the move is valid before attempting it
      if (!legalMoves.some((m: any) => m.from === moveFrom && m.to === moveTo)) {
        console.error(`Move ${moveFrom}-${moveTo} is not in the list of legal moves`);
        
        // Use a random legal move if the selected move is invalid
        const randomIndex = Math.floor(Math.random() * legalMoves.length);
        const randomMove = legalMoves[randomIndex];
        moveFrom = randomMove.from;
        moveTo = randomMove.to;
        console.log(`Using random replacement move: ${moveFrom}${moveTo}`);
      }
           
      // Make the move in chess.js
      try {
        console.log(`Attempting to make move ${moveFrom} to ${moveTo} with promotion=${movePromotion}`);
        const result = chess.move({
          from: moveFrom,
          to: moveTo,
          promotion: movePromotion
        });
        
        if (!result) {
          throw new Error(`Invalid move: ${moveFrom} to ${moveTo}`);
        }
        
        console.log(`Successfully made move: ${result.san}`);
        
        // Get the updated FEN to pass to parent
        const updatedFen = chess.fen();
        
        // Update the chessground display
        if (chessgroundRef.current) {
          const newDests = calculateDests();
          const turnColor = chess.turn() === 'w' ? 'white' : 'black';
          const canPlayerMove = turnColor === playerSide;
          
          chessgroundRef.current.set({
            fen: updatedFen,
            turnColor: turnColor,
            lastMove: [moveFrom as Key, moveTo as Key],
            movable: {
              color: playerSide,
              dests: canPlayerMove ? newDests : new Map()
            }
          });
        }
        
        // Call onMove callback with the computer's move to keep parent in sync
        if (onMove) {
          console.log("Calling onMove callback to sync with parent");
          onMove(moveFrom, moveTo);
        }
      } catch (moveError) {
        console.error("Error making move:", moveError);
        setIsProcessing(false);
      }
    } catch (error) {
      console.error("Error in makeStockfishMove function:", error);
    } finally {
      setIsProcessing(false);
    }
  }
  
  // Function to handle a user move
  async function handleMove(from: Key, to: Key) {
    try {
      // Store the evaluation before the player's move
      const chess = chessRef.current;
      
      // Store the current evaluation as the previous one before making the move
      if (currentEvalRef.current !== null) {
        previousEvalRef.current = currentEvalRef.current;
      }
      
      // Try to make the move in chess.js
      const moveResult = chess.move({
        from: from as string,
        to: to as string,
        promotion: 'q' // Always promote to queen for simplicity
      });
      
      if (!moveResult) {
        console.error('Invalid move:', from, to);
        return false;
      }
      
      // Get the updated FEN after the move for synchronization
      const updatedFen = chess.fen();
      
      // Evaluate the position after player's move - this will be compared to previousEvalRef
      // to determine how much the position changed due to player's move
      await updateEvaluation(updatedFen, currentEvalRef);
      
      // Call onMove callback if provided - pass along the updated FEN
      if (onMove) {
        // It's critical we pass the current FEN so the parent can stay in sync
        onMove(from as string, to as string);
      }
      
      // Update board position
      if (chessgroundRef.current) {
        const newDests = calculateDests();
        const turnColor = chess.turn() === 'w' ? 'white' : 'black';
        const canMove = turnColor === playerSide;
        
        chessgroundRef.current.set({
          fen: updatedFen,
          turnColor: turnColor,
          movable: { 
            color: playerSide,
            dests: canMove ? newDests : new Map() 
          },
          lastMove: [from, to]
        });
      }
      
      // Check if game is over
      const isGameOver = chess.isGameOver?.() || false;
      
      // Make computer move if game not over and it's computer's turn
      if (!isGameOver && chess.turn() === (playerSide === 'white' ? 'b' : 'w')) {
        setTimeout(() => {
          makeStockfishMove();
        }, 300);
      }
      
      return true;
    } catch (error: any) {
      console.error("Error making move:", error);
      return false;
    }
  }
  
  // Create or update chessground
  function updateChessground() {
    if (!boardRef.current || !chessRef.current) {
      console.error("Cannot update chessground: boardRef or chessRef is null");
      return;
    }
    
    // Get the current FEN directly from the chess instance
    // This ensures we're using the most up-to-date state
    let currentFen;
    try {
      currentFen = chessRef.current.fen();
    } catch (error) {
      console.error("Error getting FEN in updateChessground:", error);
      return;
    }
    
    // Calculate legal moves for the current position
    let dests;
    try {
      dests = calculateDests();
    } catch (error) {
      console.error("Error calculating legal moves:", error);
      dests = new Map(); // Empty map as fallback
    }
    
    // Get the current turn from chess.js
    let turnColor: Color = 'white';
    try {
      turnColor = chessRef.current.turn() === 'w' ? 'white' : 'black';
    } catch (error) {
      console.error("Error getting turn color:", error);
    }
    
    // Determine if the current player should be able to move
    // Only allow moves if it's the player's turn
    const canMove = turnColor === playerSide;
    
    // Configuration for chessground
    const config: Config = {
      fen: currentFen, // Use the current FEN from chess instance, not the ref
      orientation: currentOrientationRef.current,
      viewOnly: false,
      coordinates: true,
      movable: {
        free: false,
        color: playerSide, // Use playerSide instead of hardcoded 'white'
        dests: canMove ? dests : new Map(), // Only provide legal moves if it's player's turn
        events: {
          after: handleMove
        }
      },
      animation: {
        enabled: true,
        duration: 200
      },
      draggable: {
        enabled: !viewOnly && canMove, // Only enable dragging when it's player's turn
        showGhost: true
      },
      selectable: {
        enabled: !viewOnly && canMove // Only enable selection when it's player's turn
      },
      highlight: {
        lastMove: true,
        check: true
      },
      premovable: {
        enabled: false
      }
    };
    
    try {
      if (!hasInitializedRef.current) {
        // First-time initialization
        const cg = Chessground(boardRef.current, config);
        chessgroundRef.current = cg;
        hasInitializedRef.current = true;
      } else if (chessgroundRef.current) {
        // Update existing instance - avoid full reset if possible
        // Always update the position and legal moves
        const updatedMovable = {
          color: playerSide,
          dests: canMove ? dests : new Map(),
        };
        
        chessgroundRef.current.set({ 
          fen: currentFen,
          turnColor: turnColor,
          movable: updatedMovable,
          draggable: { enabled: !viewOnly && canMove },
          selectable: { enabled: !viewOnly && canMove }
        });
      }
    } catch (err: any) {
      console.error("Error initializing/updating chessground:", err);
      
      // Try to recover by reinitializing
      if (boardRef.current) {
        try {
          if (chessgroundRef.current) {
            chessgroundRef.current.destroy();
          }
          chessgroundRef.current = Chessground(boardRef.current, config);
          hasInitializedRef.current = true;
        } catch (e) {
          console.error("Failed to recover chessboard:", e);
        }
      }
    }
  }
  
  // Initialize board when component mounts or FEN/orientation changes
  useEffect(() => {
    if (!boardRef.current) return;
    
    // Store orientation in ref for easier access
    currentOrientationRef.current = orientation;
    
    // IMPORTANT: Only update the chess instance if the FEN actually changed
    // This prevents resetting the game when only orientation changes
    if (fen !== currentFenRef.current) {
      // Ensure we have a chess instance
      if (!chessRef.current) {
        chessRef.current = new Chess(fen);
        // In this case, we'll need a fresh initialization
        hasInitializedRef.current = false;
      } else {
        // If we already have a chess instance, make sure it reflects the current FEN
        chessRef.current.load(fen);
      }
      
      currentFenRef.current = fen;
    } else if (orientation !== chessgroundRef.current?.state.orientation) {
      // Just update the orientation in chessground
      if (chessgroundRef.current) {
        chessgroundRef.current.set({ orientation });
        return; // Skip the rest of the initialization
      }
    }
    
    try {
      // Create or update the chessground instance
      updateChessground();
      
      // Ensure chess instance exists before accessing its methods
      if (!chessRef.current) {
        console.error("Chess instance is null during board initialization");
        return;
      }
      
      // Determine whose turn it is and if we need to make a move
      const chess = chessRef.current;
      
      // Safely get turn color, with fallback
      let turnColor: Color = 'white';
      try {
        turnColor = chess.turn ? (chess.turn() === 'w' ? 'white' : 'black') : 'white';
      } catch (error) {
        console.error("Error getting turn:", error);
      }
      
      const isComputerTurn = turnColor !== playerSide;
      
      // If it's the computer's turn, we should make a move
      if (!viewOnly && isComputerTurn && chessgroundRef.current) {
        const isStartingPosition = fen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        
        if (isStartingPosition && playerSide === 'black') {
          // For the starting position when playing as black, we need to make white's first move
          console.log("Starting position with player as black - making white's first move via API");
          setTimeout(() => {
            makeStockfishMove();
          }, 300);
        } else if (!isStartingPosition) {
          // For any other position where it's computer's turn
          console.log(`Non-starting position with player as ${playerSide} and ${turnColor} to move - making computer's move`);
          setTimeout(() => {
            makeStockfishMove();
          }, 500);
        }
      }
    } catch (error: any) {
      console.error("Error initializing board:", error);
    }
    
    // Cleanup on unmount
    return () => {
      if (chessgroundRef.current) {
        chessgroundRef.current.destroy();
        chessgroundRef.current = null;
        hasInitializedRef.current = false;
      }
    };
  }, [fen, orientation, playerSide, viewOnly]);
  
  // Initialize the chess instance once only - must run before any other effects
  useEffect(() => {
    try {
      // Always recreate the chess instance with the current FEN
      chessRef.current = new Chess(fen);
      console.log("Created new Chess instance with FEN:", fen);
    } catch (error) {
      console.error("Error creating Chess instance:", error);
    }
  }, [fen, playerSide]); // Recreate when FEN or playerSide changes
  
  // Initialize the evaluation when the board is first set up or player side changes
  useEffect(() => {
    // Check if player side has changed
    const hasPlayerSideChanged = previousPlayerSideRef.current !== playerSide;
    if (hasPlayerSideChanged) {
      // Update the previous player side
      previousPlayerSideRef.current = playerSide;
      // Reset the evaluation initialization flag when player side changes
      hasInitializedEvaluationRef.current = false;
      console.log(`Player side changed to ${playerSide}, will reinitialize evaluation`);
    }
    
    // Only run this if we have a chess instance and haven't initialized evaluation for this playerSide yet
    if (chessRef.current && !hasInitializedEvaluationRef.current) {
      console.log(`Initializing evaluation for playerSide=${playerSide}`);
      
      // Update the flag to prevent duplicate initialization
      hasInitializedEvaluationRef.current = true;
      
      // Initialize evaluation references
      const initEvaluation = async () => {
        try {
          // Make sure chess instance exists before trying to access fen
          if (!chessRef.current) {
            console.error("Chess instance is null during evaluation init");
            previousEvalRef.current = 0;
            currentEvalRef.current = 0;
            return;
          }
          
          console.log("Initializing position evaluation");
          
          // Set both references to the same initial evaluation
          await updateEvaluation(chessRef.current.fen(), previousEvalRef);
          currentEvalRef.current = previousEvalRef.current;
          
          console.log(`Initial evaluation set to ${previousEvalRef.current}`);
          
          // If player is black and it's the starting position, we need to prepare
          // for the first white move with proper evaluation
          const isStartingPosition = chessRef.current.fen().includes('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w');
          if (playerSide === 'black' && isStartingPosition) {
            console.log("Player is black with starting position - initializing with zero evaluation change");
            // When playing as black, the first white move should use even-move with 0 evaluation change
            // This ensures we handle the switch sides scenario correctly
            previousEvalRef.current = 0;
            currentEvalRef.current = 0;
          }
        } catch (error) {
          console.error("Error initializing evaluation:", error);
          // Set safe defaults
          previousEvalRef.current = 0;
          currentEvalRef.current = 0;
        }
      };
      
      initEvaluation();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerSide]);
  
  return (
    <div className="w-full h-full relative overflow-hidden" style={{ borderRadius: '8px' }}>
      <div ref={boardRef as any} className="w-full h-full overflow-hidden" style={{ borderRadius: '8px' }} />
      {isProcessing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 z-10">
          <div className="text-white text-lg font-bold">Stockfish is thinking...</div>
        </div>
      )}
    </div>
  );
}

export default Chessboard; 