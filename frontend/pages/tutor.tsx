import React, { ReactNode, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { useSession, useSupabaseClient } from '@supabase/auth-helpers-react';
import Chessboard from '@/components/Chessboard';
import { Chess } from 'chess.js';
import Head from 'next/head';
import Button from '../components/ui/Button';
import toast from 'react-hot-toast';

interface TutorPageProps {
  children?: ReactNode;
}

function TutorPage() {
  const router = useRouter();
  const session = useSession();
  const supabase = useSupabaseClient();
  const chessRef = useRef(new Chess());
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [playerSide, setPlayerSide] = useState<'white' | 'black'>('white');
  const [gameStatus, setGameStatus] = useState<string>('');
  const [fen, setFen] = useState<string>(chessRef.current.fen());
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [isGameOver, setIsGameOver] = useState<boolean>(false);
  const [gameStartTime, setGameStartTime] = useState<Date>(new Date());
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!session) {
      router.push('/login');
    }
  }, [session, router]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // If menu is not open, don't do anything
      if (!menuOpen) return;
      
      // Check if the click was outside both the menu and the menu button
      const menuElement = menuRef.current;
      const buttonElement = menuButtonRef.current;
      
      const targetElement = event.target as Node;
      
      const isOutsideMenu = menuElement && !menuElement.contains(targetElement);
      const isOutsideButton = buttonElement && !buttonElement.contains(targetElement);
      
      // If clicked outside both menu and button, close the menu
      if (isOutsideMenu && isOutsideButton) {
        setMenuOpen(false);
      }
    };
    
    // Add the event listener
    document.addEventListener('mousedown', handleClickOutside);
    
    // Clean up
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  // Reset game start time when a new game begins
  useEffect(() => {
    if (moveHistory.length === 0) {
      setGameStartTime(new Date());
    }
  }, [moveHistory]);

  // Save game when it ends
  useEffect(() => {
    const saveGame = async () => {
      if (isGameOver && moveHistory.length > 0 && session) {
        try {
          // Get the PGN from the chess instance
          const chess = chessRef.current;
          const chessAny = chess as any; // Using any type to handle version differences in chess.js
          
          // Set the headers for the PGN
          if (typeof chessAny.header === 'function') {
            chessAny.header(
              'Event', 'Chess Tutor Game',
              'Site', 'Chess Tutor',
              'Date', new Date().toISOString().split('T')[0],
              'White', playerSide === 'white' ? session.user.email : 'Stockfish 0',
              'Black', playerSide === 'black' ? session.user.email : 'Stockfish 0',
              'WhiteElo', playerSide === 'white' ? '?' : '1350', // Approximate ELO for skill level 0
              'BlackElo', playerSide === 'black' ? '?' : '1350',
              'TimeControl', '-',
              'Result', chessAny.in_checkmate?.() ? (chessAny.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2'
            );
          }

          const pgn = typeof chessAny.pgn === 'function' ? chessAny.pgn() : '';
          const inCheckmate = typeof chessAny.in_checkmate === 'function' ? chessAny.in_checkmate() : false;
          const turn = typeof chessAny.turn === 'function' ? chessAny.turn() : 'w';
          
          const result = inCheckmate 
            ? (turn === 'w' ? '0-1' : '1-0') 
            : '1/2-1/2';
          
          // Generate a unique game ID
          const uniqueGameId = `tutor_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
          
          // Insert the game using the RPC function
          const { data, error } = await supabase.rpc('insert_game', {
            p_pgn: pgn,
            p_result: result
          });
          
          if (error) {
            console.error('Error saving game:', error);
            toast.error('Failed to save your game');
            return;
          }
          
          // Update the game to set cpu = true and other metadata
          const { error: updateError } = await supabase
            .from('games')
            .update({
              cpu: true,
              white_player: playerSide === 'white' ? session.user.email : 'Stockfish 0',
              black_player: playerSide === 'black' ? session.user.email : 'Stockfish 0',
              white_elo: playerSide === 'white' ? null : 1350,
              black_elo: playerSide === 'black' ? null : 1350,
              platform: 'Chess Tutor',
              start_time: gameStartTime.toISOString(),
              end_time: new Date().toISOString(),
              termination: inCheckmate ? 'checkmate' : 
                          chessAny.in_stalemate?.() ? 'stalemate' : 
                          chessAny.in_draw?.() ? 'draw' : 'normal',
              unique_game_id: uniqueGameId,
              user_color: playerSide
            })
            .eq('id', data);
            
          if (updateError) {
            console.error('Error updating game metadata:', updateError);
          } else {
            toast.success('Game saved successfully!');
          }
          
        } catch (error) {
          console.error('Error in game saving process:', error);
          toast.error('An error occurred while saving your game');
        }
      }
    };
    
    saveGame();
  }, [isGameOver, moveHistory, session, playerSide, supabase, gameStartTime]);

  const handleMove = (from: string, to: string) => {
    try {
      // Get reference to chess instance
      const chess = chessRef.current;
      const chessAny = chess as any;
      
      console.log(`Parent component handling move from ${from} to ${to}`);
      
      // IMPORTANT: First, load the current position from the Chessboard component
      // to ensure our chess instance is in sync
      try {
        // We need to ensure the parent's chess.js instance is in sync with the board
        const childFen = chessAny.fen();
        console.log("Syncing parent chess instance with FEN:", childFen);
        
        if (typeof chessAny.load === 'function') {
          chessAny.load(childFen);
        }
      } catch (loadError) {
        console.error('Error loading position:', loadError);
      }
      
      // Now that our chess instance is in sync, we can extract the last move
      let lastMoveSan = '';
      
      try {
        // Get the history of moves
        const history = typeof chessAny.history === 'function' ? 
          (chessAny.history({ verbose: false }) || []) : [];
        
        // Get the last move in SAN format
        if (history.length > 0) {
          lastMoveSan = history[history.length - 1];
          console.log(`Got last move SAN: ${lastMoveSan}`);
        } else {
          // Fallback if we can't get the move history
          lastMoveSan = `${from}-${to}`;
          console.log(`Using fallback move notation: ${lastMoveSan}`);
        }
      } catch (historyError) {
        console.error('Error getting move history:', historyError);
        lastMoveSan = `${from}-${to}`;
      }
      
      // Update move history with the SAN notation
      if (lastMoveSan) {
        setMoveHistory(prev => {
          const newHistory = [...prev, lastMoveSan];
          console.log(`Move history updated:`, newHistory);
          return newHistory;
        });
      }
      
      // Update our FEN state
      const updatedPosition = chessAny.fen();
      setFen(updatedPosition);
      
      // For debugging
      console.log("Game state updated:", {
        currentPosition: updatedPosition,
        turn: chessAny.turn(),
        moveCount: typeof chessAny.history === 'function' ? 
          chessAny.history().length : 0
      });
      
      // Check game status
      const isCheckmate = typeof chessAny.in_checkmate === 'function' ? 
        chessAny.in_checkmate() : false;
      const isDraw = typeof chessAny.in_draw === 'function' ? 
        chessAny.in_draw() : false;
      const isStalemate = typeof chessAny.in_stalemate === 'function' ? 
        chessAny.in_stalemate() : false;
      const isThreefoldRepetition = typeof chessAny.in_threefold_repetition === 'function' ? 
        chessAny.in_threefold_repetition() : false;
      
      const gameOver = isCheckmate || isDraw || isStalemate || isThreefoldRepetition;
      setIsGameOver(gameOver);
      
      if (gameOver) {
        if (isCheckmate) {
          setGameStatus('Checkmate!');
        } else if (isDraw) {
          setGameStatus('Draw!');
        } else if (isStalemate) {
          setGameStatus('Stalemate!');
        } else if (isThreefoldRepetition) {
          setGameStatus('Draw by repetition!');
        } else if (typeof chessAny.insufficient_material === 'function' ? 
          chessAny.insufficient_material() : false) {
          setGameStatus('Draw by insufficient material!');
        }
      } else if (typeof chessAny.in_check === 'function' && chessAny.in_check()) {
        setGameStatus('Check!');
      } else {
        setGameStatus('');
      }
    } catch (e) {
      console.error('Error handling move:', e);
    }
  };

  const resetGame = () => {
    const chess = chessRef.current;
    chess.reset();
    setFen(chess.fen());
    setGameStatus('');
    setMoveHistory([]);
    setIsGameOver(false);
    setGameStartTime(new Date());
    toast.success('New game started!');
  };
  
  const switchSides = () => {
    // Switch the player's side
    const newPlayerSide = playerSide === 'white' ? 'black' : 'white';
    
    // Reset everything to a clean slate
    const startingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    
    // Reset the chess instance
    const chess = chessRef.current;
    chess.reset();
    
    // Update all state variables at once to avoid race conditions
    setPlayerSide(newPlayerSide);
    setOrientation(newPlayerSide);
    setFen(startingFen);
    setGameStatus('');
    setMoveHistory([]);
    setIsGameOver(false);
    setGameStartTime(new Date());
    
    console.log(`Switched sides to ${newPlayerSide}`);
    
    // Close the menu
    setMenuOpen(false);
    
    toast.success(`You are now playing as ${newPlayerSide}`);
  };

  const resignGame = () => {
    const chess = chessRef.current;
    const chessAny = chess as any;
    
    // Set game as over
    setIsGameOver(true);
    
    // Display resignation message
    setGameStatus(`${playerSide === 'white' ? 'White' : 'Black'} resigned`);
  };
  
  // Remove the automatic first move effect - user wants to control both sides
  useEffect(() => {
    console.log("Game state updated:", {
      moveHistory: moveHistory,
      playerSide: playerSide,
      orientation: orientation,
      isGameOver: isGameOver,
      fen: fen,
      canSwitchSides: moveHistory.length === 0 || isGameOver
    });
  }, [moveHistory, playerSide, orientation, isGameOver, fen]);
  
  // More reliable way to determine if Switch Sides button should be visible
  const canSwitchSides = () => {
    const chess = chessRef.current;
    const chessAny = chess as any; // Using any to handle version differences in chess.js
    
    // Always get the CURRENT FEN directly from the chess instance
    const currentFen = chess.fen();
    
    // The starting position FEN
    const startingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    
    // Check whose turn it is - if it's black's turn, a move has already been made
    const isBlackTurn = currentFen.includes(' b ');
    
    // Check exact match with starting position
    const isStartingPosition = currentFen === startingFen;
    
    // Additional checks for any move being made
    // 1. Look at move history length
    const moveHistoryLength = moveHistory.length;
    
    // 2. Check if we have history in the chess object
    const chessHistoryLength = typeof chessAny.history === 'function' ? 
                              chessAny.history().length : 0;
    
    // 3. Check halfmove clock in the FEN (should be 0 at start)
    // FEN structure: [position] [turn] [castling] [en passant] [halfmove clock] [fullmove number]
    const fenParts = currentFen.split(' ');
    const halfMoveClock = fenParts.length >= 5 ? parseInt(fenParts[4], 10) : 0;
    const fullMoveNumber = fenParts.length >= 6 ? parseInt(fenParts[5], 10) : 1;
    
    // A move has been made if:
    // - We're not at the starting position, OR
    // - It's black's turn, OR 
    // - Move history shows moves, OR
    // - Chess history shows moves, OR
    // - Full move number is > 1, OR
    // - Half move clock is > 0
    const moveHasBeenMade = !isStartingPosition || 
                           isBlackTurn || 
                           moveHistoryLength > 0 || 
                           chessHistoryLength > 0 ||
                           fullMoveNumber > 1 ||
                           halfMoveClock > 0;
    
    console.log("Can switch sides check:", { 
      isStartingPosition, 
      isGameOver,
      isBlackTurn,
      currentFen,
      moveHistoryLength,
      chessHistoryLength,
      halfMoveClock,
      fullMoveNumber,
      moveHasBeenMade
    });
    
    // Only allow switching at the very beginning (before any moves) or when game is over
    return (!moveHasBeenMade) || isGameOver;
  };

  // If not logged in, show nothing (will redirect)
  if (!session) {
    return null;
  }

  return (
    <>
      <Head>
        <title>Chess Tutor</title>
      </Head>
      <div className="w-full max-w-3xl flex flex-col items-center justify-center">
        <div className="relative w-full aspect-square" style={{ maxWidth: '600px' }}>
          <div className="absolute top-2 right-2 z-20">
            <div className="relative">
              <button 
                ref={menuButtonRef}
                onClick={() => setMenuOpen(!menuOpen)}
                className="cursor-pointer bg-gray-800 bg-opacity-60 hover:bg-opacity-80 text-white p-1.5 rounded-full flex items-center justify-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              
              {menuOpen && (
                <div 
                  ref={menuRef}
                  className="absolute top-full right-0 mt-1 w-36 bg-gray-800 rounded-md shadow-lg overflow-hidden z-20"
                >
                  <div className="py-1">
                    <button 
                      onClick={() => {
                        // Get the current position DIRECTLY from the chess instance
                        const currentPosition = chessRef.current.fen();
                        
                        // Only change the visual orientation, not the player's side
                        setOrientation(orientation === 'white' ? 'black' : 'white');
                        
                        // Update the FEN state with the current position
                        // to maintain game state consistency
                        setFen(currentPosition);
                        
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 flex items-center"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                      </svg>
                      Flip Board
                    </button>
                    
                    {canSwitchSides() && (
                      <button 
                        onClick={() => {
                          switchSides();
                          setMenuOpen(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 flex items-center"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        Switch Sides
                      </button>
                    )}
                    
                    <button 
                      onClick={() => {
                        resignGame();
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700 flex items-center"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5L15 7h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      </svg>
                      Resign
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="w-full h-full">
            {/* 
              The Chess Tutor's adaptive learning system:
              - Uses the "even-move" endpoint for a more forgiving learning experience
              - Tracks position evaluation before and after player moves
              - When player makes a mistake, engine responds with a move that maintains
                relative evaluation instead of maximizing advantage
              - This gives players opportunity to recover and learn from mistakes
              - Skill level 0 (approx. 1350 ELO) makes it suitable for beginners
            */}
            <Chessboard 
              key={`board-${playerSide}-${isGameOver ? 'over' : 'playing'}`} // Force remount when player side changes
              fen={fen} 
              onMove={handleMove}
              orientation={orientation}
              playerSide={playerSide}
              skillLevel={0} // Set Stockfish to skill level 0
            />
          </div>
        </div>
        
        {gameStatus && (
          <div className="mt-4 px-6 py-3 bg-white bg-opacity-80 backdrop-blur-sm rounded-lg shadow-lg">
            <p className="text-center font-medium text-gray-800">{gameStatus}</p>
          </div>
        )}
        
        {moveHistory.length > 0 && (
          <div className="mt-4 w-full max-w-md px-4 py-3 bg-white bg-opacity-90 backdrop-blur-sm rounded-lg shadow-lg">
            <h3 className="text-center text-gray-700 font-medium mb-2">Move History</h3>
            <div className="overflow-auto max-h-40 p-2">
              <div className="grid grid-cols-2 gap-2">
                {moveHistory.map((move, index) => (
                  <div 
                    key={index} 
                    className={`text-sm ${index % 2 === 0 ? 'text-right pr-3 border-r border-gray-300' : 'text-left pl-3'}`}
                  >
                    {index % 2 === 0 && <span className="text-gray-500 mr-2">{Math.floor(index/2) + 1}.</span>}
                    {move}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default TutorPage; 