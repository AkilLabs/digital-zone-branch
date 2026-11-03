import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

interface Option {
    id: string;
    name: string;
}

interface SearchableSelectProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
    options: Option[];
    value: string;
    onChange: (value: string) => void;
    className?: string;
    placeholder?: string;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
    options,
    value,
    onChange,
    className,
    placeholder,
    disabled,
    onKeyDown, // Important for table navigation
    ...props
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState(value);
    const [filteredOptions, setFilteredOptions] = useState<Option[]>(options);
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setSearchTerm(value);
    }, [value]);

    useEffect(() => {
        if (isOpen) {
            // Filter options based on search term
            // If the search term is exactly equal to an option, show all? No, just filter standardly.
            // But if user opens and text is "Apple", they might want to see other "App..." or just "Apple".
            // Standard: filter by contains
            const lower = searchTerm.toLowerCase();
            const filtered = options.filter(opt => opt.name.toLowerCase().includes(lower));
            setFilteredOptions(filtered);
        }
    }, [searchTerm, options, isOpen]);

    const updatePosition = () => {
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setDropdownPosition({
                top: rect.bottom + window.scrollY,
                left: rect.left + window.scrollX,
                width: rect.width
            });
        }
    };

    useEffect(() => {
        if (isOpen) {
            updatePosition();
            window.addEventListener('resize', updatePosition);
            window.addEventListener('scroll', updatePosition, true); // Capture phase for all scrollables
            return () => {
                window.removeEventListener('resize', updatePosition);
                window.removeEventListener('scroll', updatePosition, true);
            };
        }
    }, [isOpen]);

    // Click outside to close
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (
                containerRef.current && !containerRef.current.contains(e.target as Node) &&
                dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
                // Revert to last valid value if current search term is not in options
                const isValid = options.some(opt => opt.name === searchTerm);
                if (!isValid) {
                    setSearchTerm(value); // Revert to the valid value
                }
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen, options, searchTerm, value]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVal = e.target.value;
        setSearchTerm(newVal);
        // Don't propagate text change immediately - only allow selection from dropdown
        setIsOpen(true);
        setFocusedIndex(0);
    };

    const handleFocus = () => {
        if (!disabled) {
            setIsOpen(true);
            // Reset filter to show all options
            setFilteredOptions(options);
            setFocusedIndex(0);
        }
    };

    const handleBlur = () => {
        // Revert to last valid value if current search term is not in options
        const isValid = options.some(opt => opt.name === searchTerm);
        if (!isValid) {
            setSearchTerm(value); // Revert to the valid value
        }
    };

    const handleSelect = (option: Option) => {
        onChange(option.name);
        setSearchTerm(option.name);
        setIsOpen(false);
        setFocusedIndex(null);
        // Keep focus on input?
        inputRef.current?.focus();
    };

    const handleInternalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Handle list navigation if open
        if (isOpen && filteredOptions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation(); // Stop table navigation
                setFocusedIndex(prev => {
                    if (prev === null) return 0;
                    return Math.min(filteredOptions.length - 1, prev + 1);
                });
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                setFocusedIndex(prev => {
                    if (prev === null) return filteredOptions.length - 1;
                    return Math.max(0, prev - 1);
                });
                return;
            }
            if (e.key === 'Enter') {
                if (focusedIndex !== null && filteredOptions[focusedIndex]) {
                    e.preventDefault();
                    e.stopPropagation(); // Stop table form submission
                    handleSelect(filteredOptions[focusedIndex]);
                    return;
                } else if (filteredOptions.length > 0) {
                    // Auto-select first option if user didn't navigate
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelect(filteredOptions[0]);
                    return;
                } else {
                    // No matches - revert to valid value and allow Enter to move to next cell
                    const isValid = options.some(opt => opt.name === searchTerm);
                    if (!isValid) {
                        setSearchTerm(value);
                    }
                    setIsOpen(false);
                    // Don't prevent default - allow table navigation
                }
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setIsOpen(false);
                // Revert to last valid value
                const isValid = options.some(opt => opt.name === searchTerm);
                if (!isValid) {
                    setSearchTerm(value);
                }
                return;
            }
        } else {
            // If closed, allow ArrowDown to open relevant list?
            if (e.key === 'ArrowDown' && !isOpen) {
                setIsOpen(true);
                e.preventDefault();
                e.stopPropagation(); // Don't move down row yet
                return;
            }
        }

        // Otherwise pass to parent (for table navigation)
        if (onKeyDown) {
            onKeyDown(e);
        }
    };

    return (
        <div ref={containerRef} className="relative w-full">
            <input
                ref={inputRef}
                type="text"
                value={searchTerm}
                onChange={handleInputChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleInternalKeyDown}
                disabled={disabled}
                className={`w-full px-3 py-2 text-sm border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-transparent ${className}`}
                placeholder={placeholder}
                autoComplete="off"
                {...props}
            />

            {/* Dropdown Portal */}
            {isOpen && dropdownPosition && createPortal(
                <div
                    ref={dropdownRef}
                    style={{
                        position: 'absolute',
                        top: dropdownPosition.top,
                        left: dropdownPosition.left,
                        width: dropdownPosition.width,
                        zIndex: 9999
                    }}
                    className="bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                >
                    {filteredOptions.length > 0 ? (
                        filteredOptions.map((option, idx) => (
                            <div
                                key={option.id}
                                onClick={() => handleSelect(option)}
                                className={`px-3 py-2 cursor-pointer text-sm flex items-center justify-between ${idx === focusedIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-900'
                                    }`}
                            >
                                <span>{option.name}</span>
                                {value === option.name && <Check size={14} className="text-blue-600" />}
                            </div>
                        ))
                    ) : (
                        <div className="px-3 py-2 text-sm text-gray-500">No results found</div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
};

export default SearchableSelect;
