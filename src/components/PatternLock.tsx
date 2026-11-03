import React, { useState, useEffect, useRef } from 'react';

interface PatternLockProps {
    /** If 'input', user can draw. If 'view', user cannot draw. */
    mode?: 'input' | 'view';
    /** Call whenever the pattern changes (in input mode). */
    onChange?: (pattern: number[]) => void;
    /** If provided, overrides internal state (controlled component). */
    pattern?: number[];
    /** Initial pattern to animate in view mode */
    initialPattern?: number[];
    /** Size of the grid in pixels. */
    size?: number;
    /** Function called when drawing ends (mouse up / touch end). */
    onEnd?: () => void;
    /** Highlight dots/lines in red to indicate error */
    error?: boolean;
}

const PatternLock: React.FC<PatternLockProps> = ({
    mode = 'input',
    onChange,
    pattern: controlledPattern,
    initialPattern = [],
    size = 280,
    onEnd,
    error = false
}) => {
    // Internal state for uncontrolled mode
    const [internalPattern, setInternalPattern] = useState<number[]>([]);
    const [cursorPos, setCursorPos] = useState<{ x: number, y: number } | null>(null);

    // Use controlled pattern if provided, otherwise internal
    const activePattern = controlledPattern !== undefined ? controlledPattern : internalPattern;
    const activePatternRef = useRef(activePattern);
    const onChangeRef = useRef(onChange);
    const controlledPatternRef = useRef(controlledPattern);

    useEffect(() => {
        activePatternRef.current = activePattern;
    }, [activePattern]);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        controlledPatternRef.current = controlledPattern;
    }, [controlledPattern]);

    const [isDrawing, setIsDrawing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Dimensions
    const padding = 30;
    const availableSize = size - (padding * 2);
    const step = availableSize / 2;

    const getDotPos = (index: number) => {
        const row = Math.floor(index / 3);
        const col = index % 3;
        return {
            x: padding + col * step,
            y: padding + row * step
        };
    };

    const getIndexFromPoint = (x: number, y: number) => {
        for (let i = 0; i < 9; i++) {
            const pos = getDotPos(i);
            const dist = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));
            if (dist < 40) return i; // Increased from 30 to 40
        }
        return -1;
    };

    const updateCursor = (clientX: number, clientY: number) => {
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setCursorPos({
                x: clientX - rect.left,
                y: clientY - rect.top
            });
        }
    };

    // --- Global Event Handlers for Robust Drawing ---

    const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
        if (e.cancelable) e.preventDefault(); // Stop scrolling/selection

        const { clientX, clientY } = 'touches' in e ? (e as TouchEvent).touches[0] : (e as MouseEvent);
        updateCursor(clientX, clientY);

        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;

            // 1. Direct hit check (increased radius for better feel)
            let newIndex = -1;

            // Check all unselected dots
            for (let i = 0; i < 9; i++) {
                if (activePatternRef.current.includes(i)) continue;

                const pos = getDotPos(i);
                const dist = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));

                // Increased hit radius to 40px (dots have approx 60px space between centers usually)
                if (dist < 40) {
                    newIndex = i;
                    break;
                }
            }

            // 2. Line Intersection Check (for fast swipes)
            const currentPattern = activePatternRef.current;
            if (newIndex === -1 && currentPattern.length > 0) {
                const lastIndex = currentPattern[currentPattern.length - 1];
                const lastPos = getDotPos(lastIndex);

                // Vector from last dot to cursor
                const v1 = { x: x - lastPos.x, y: y - lastPos.y };
                const lineLen = Math.sqrt(v1.x * v1.x + v1.y * v1.y);

                // Only if line is long enough to have skipped something
                if (lineLen > 20) {
                    // Normalized vector
                    const dir = { x: v1.x / lineLen, y: v1.y / lineLen };

                    // Check all unselected dots
                    // We iterate in a way to find closest-to-start first if multiple matches?
                    // Simple iteration is usually OK for 3x3
                    let bestT = Infinity;

                    for (let i = 0; i < 9; i++) {
                        if (currentPattern.includes(i)) continue;

                        const dotPos = getDotPos(i);
                        // Vector from last dot to this unselected dot
                        const v2 = { x: dotPos.x - lastPos.x, y: dotPos.y - lastPos.y };

                        // Project v2 onto v1 to find closest point on line
                        const t = (v2.x * dir.x + v2.y * dir.y);

                        // If t is between 0 and lineLen, the dot is "beside" the line segment
                        if (t > 10 && t < lineLen - 10) { // Buffer zone
                            const closest = {
                                x: lastPos.x + t * dir.x,
                                y: lastPos.y + t * dir.y
                            };
                            const distToLine = Math.sqrt(Math.pow(dotPos.x - closest.x, 2) + Math.pow(dotPos.y - closest.y, 2));

                            // If center of dot is very close to the line (within 30px), select it
                            if (distToLine < 30) {
                                if (t < bestT) {
                                    bestT = t;
                                    newIndex = i;
                                }
                            }
                        }
                    }
                }
            }

            // Add found dot
            if (newIndex !== -1) {
                if (!currentPattern.includes(newIndex)) {
                    const newPattern = [...currentPattern, newIndex];

                    // If uncontrolled, update internal state
                    if (controlledPatternRef.current === undefined) {
                        setInternalPattern(newPattern);
                    }
                    // Always trigger onChange
                    onChangeRef.current?.(newPattern);
                }
            }
        }
    };

    const handleGlobalUp = () => {
        setIsDrawing(false);
        setCursorPos(null);
        onEnd?.();
    };

    // Attach/Detach Global Listeners
    useEffect(() => {
        if (isDrawing) {
            window.addEventListener('mousemove', handleGlobalMove);
            window.addEventListener('mouseup', handleGlobalUp);
            window.addEventListener('touchmove', handleGlobalMove, { passive: false });
            window.addEventListener('touchend', handleGlobalUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleGlobalMove);
            window.removeEventListener('mouseup', handleGlobalUp);
            window.removeEventListener('touchmove', handleGlobalMove);
            window.removeEventListener('touchend', handleGlobalUp);
        };
    }, [isDrawing]);


    const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
        if (mode === 'view') return;
        if (e.type === 'mousedown') e.preventDefault();

        setIsDrawing(true);
        const newPattern: number[] = [];
        const { clientX, clientY } = 'touches' in e ? e.touches[0] : (e as React.MouseEvent);
        updateCursor(clientX, clientY);

        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const index = getIndexFromPoint(clientX - rect.left, clientY - rect.top);
            if (index !== -1) {
                newPattern.push(index);
            }
        }

        if (controlledPattern === undefined) {
            setInternalPattern(newPattern);
        }
        onChange?.(newPattern);
    };

    // Animation Logic for 'view' mode
    useEffect(() => {
        if (mode === 'view' && initialPattern.length > 0) {
            setInternalPattern([]);

            let currentIndex = 0;
            const animate = () => {
                if (currentIndex < initialPattern.length) {
                    setInternalPattern(initialPattern.slice(0, currentIndex + 1));
                    currentIndex++;
                    setTimeout(animate, 400);
                } else {
                    setTimeout(() => {
                        setInternalPattern([]);
                        currentIndex = 0;
                        setTimeout(animate, 500);
                    }, 1500);
                }
            };
            const timer = setTimeout(animate, 500);
            return () => clearTimeout(timer);
        } else if (mode === 'view') {
            setInternalPattern([]);
        }
    }, [mode, initialPattern]);

    const renderPattern = mode === 'view' ? internalPattern : activePattern;

    return (
        <div
            ref={containerRef}
            className={`relative select-none bg-white rounded-xl shadow-inner border border-gray-200 touch-none ${mode === 'input' ? 'cursor-pointer' : ''}`}
            style={{ width: size, height: size, touchAction: 'none' }}
            onMouseDown={handleStart}
            onTouchStart={handleStart}
        >
            {/* SVG Lines */}
            <svg className="absolute inset-0 pointer-events-none w-full h-full text-blue-500">
                {/* Drawn Lines */}
                {renderPattern.map((dotIndex, i) => {
                    if (i === 0) return null;
                    const prevPos = getDotPos(renderPattern[i - 1]);
                    const currPos = getDotPos(dotIndex);
                    return (
                        <line
                            key={i}
                            x1={prevPos.x}
                            y1={prevPos.y}
                            x2={currPos.x}
                            y2={currPos.y}
                            stroke={error ? "#ef4444" : (mode === 'view' ? "#22c55e" : "#3b82f6")}
                            strokeWidth="4"
                            strokeLinecap="round"
                            className="transition-all duration-200"
                        />
                    );
                })}

                {/* Active Drag Line - Visible even if error is true to avoid stutter */}
                {mode === 'input' && isDrawing && cursorPos && renderPattern.length > 0 && (
                    <line
                        x1={getDotPos(renderPattern[renderPattern.length - 1]).x}
                        y1={getDotPos(renderPattern[renderPattern.length - 1]).y}
                        x2={cursorPos.x}
                        y2={cursorPos.y}
                        stroke={error ? "#fca5a5" : "#93c5fd"} // Light red if error, Light blue if ok
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray="5,5"
                        className="opacity-70 transition-colors"
                    />
                )}
            </svg>

            {/* Dots Layer */}
            {Array.from({ length: 9 }).map((_, i) => {
                const pos = getDotPos(i);
                const isSelected = renderPattern.includes(i);
                const isStart = renderPattern[0] === i;
                const isEnd = renderPattern[renderPattern.length - 1] === i;

                return (
                    <div
                        key={i}
                        className={`absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-300 flex items-center justify-center rounded-full
                            ${isSelected
                                ? (error ? 'bg-red-100 scale-110' : (mode === 'view' ? 'bg-green-100 scale-110' : 'bg-blue-100 scale-110'))
                                : 'hover:bg-gray-100'
                            }
                        `}
                        style={{
                            left: pos.x,
                            top: pos.y,
                            width: 50,
                            height: 50,
                        }}
                    >
                        <div
                            className={`rounded-full transition-all duration-300
                                ${isSelected
                                    ? (error ? 'w-5 h-5 bg-red-500 shadow-lg' : (mode === 'view' ? 'w-5 h-5 bg-green-500 shadow-lg' : 'w-5 h-5 bg-blue-600 shadow-lg'))
                                    : 'w-3 h-3 bg-gray-300'
                                }
                            `}
                        />

                        {/* View Mode Indicators */}
                        {mode === 'view' && isStart && renderPattern.length > 1 && (
                            <div className="absolute -top-8 bg-green-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm whitespace-nowrap z-10">
                                Start
                            </div>
                        )}
                        {mode === 'view' && isEnd && renderPattern.length > 1 && (
                            <div className="absolute -bottom-8 bg-gray-800 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm whitespace-nowrap z-10">
                                End
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default PatternLock;
