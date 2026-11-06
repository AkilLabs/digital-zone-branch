import React, { useState, useEffect } from 'react';
import { X, Plus, CheckCircle, Tag, Smartphone } from 'lucide-react';
import { updateDoc, serverTimestamp } from 'firebase/firestore';
import { useStore } from '../context/StoreContext';
import { upsertLocalProducts } from '../utils/productSyncCache';
import type { Product } from '../types';

interface SuitableModelsModalProps {
    product: Product;
    onClose: () => void;
    onUpdate: () => void;
}

const SuitableModelsModal: React.FC<SuitableModelsModalProps> = ({ product, onClose, onUpdate }) => {
    const { getDocRef, currentStore } = useStore();
    const [inputValue, setInputValue] = useState('');
    const [tags, setTags] = useState<string[]>(product.suitableModels || []);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Sync tags with product.suitableModels when product changes
    useEffect(() => {
        setTags(product.suitableModels || []);
    }, [product.id, product.suitableModels]);

    // Keyboard shortcut to close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // Add tags helper
    const addModels = (rawText: string) => {
        const clean = rawText
            .split(/[,|\n]+/)
            .map(m => m.trim().toUpperCase())
            .filter(m => m.length > 0 && !tags.includes(m));

        if (clean.length > 0) {
            setTags(prev => [...prev, ...clean]);
        }
        setInputValue('');
    };

    // Handle input change and auto-split commas
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.toUpperCase();
        if (val.includes(',')) {
            addModels(val);
        } else {
            setInputValue(val);
        }
    };

    // Handle Enter key
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (inputValue.trim()) {
                addModels(inputValue);
            }
        }
    };

    // Remove a tag
    const removeTag = (tagToRemove: string) => {
        setTags(prev => prev.filter(tag => tag !== tagToRemove));
    };

    // Save suitable models to Firestore & local cache
    const handleSave = async () => {
        if (!product.id) return;

        try {
            setIsSubmitting(true);
            const productRef = getDocRef('products', product.id);
            await updateDoc(productRef, {
                suitableModels: tags,
                updatedAt: serverTimestamp()
            });
            await upsertLocalProducts(currentStore?.id, [{
                ...product,
                id: product.id,
                suitableModels: tags,
                updatedAt: new Date()
            }]);

            onUpdate();
            onClose();
        } catch (error) {
            console.error('Error updating suitable models:', error);
            alert('Failed to update suitable models. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-end sm:items-center justify-center z-50 sm:p-4 animate-in fade-in duration-150"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div
                className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col border border-slate-200 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between p-5 pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                            <Smartphone className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-slate-900">Compatible Models</h2>
                            <p className="text-xs text-slate-500 mt-0.5">Define phone & device compatibility</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                        aria-label="Close dialog"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-5 overflow-y-auto flex-1 space-y-4">
                    {/* Compact Product Banner */}
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80">
                        <div className="font-semibold text-slate-900 text-sm truncate">{product.name}</div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                            <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">{product.productCode}</span>
                            <span>•</span>
                            <span>{product.brand}</span>
                            {product.category && (
                                <>
                                    <span>•</span>
                                    <span>{product.category}</span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Quick Input Bar */}
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            Add Models
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={inputValue}
                                onChange={handleInputChange}
                                onKeyDown={handleKeyDown}
                                placeholder="e.g. iPhone 13, iPhone 14 Pro, Vivo Y20..."
                                className="flex-1 px-3.5 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 placeholder:text-slate-400"
                                autoFocus
                            />
                            <button
                                type="button"
                                onClick={() => addModels(inputValue)}
                                disabled={!inputValue.trim()}
                                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white rounded-xl text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-xs"
                            >
                                <Plus className="w-4 h-4" />
                                <span>Add</span>
                            </button>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1.5">Tip: Separate multiple models with a comma or press Enter.</p>
                    </div>

                    {/* Models Tag Cloud */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-slate-700">
                                Assigned Models ({tags.length})
                            </span>
                            {tags.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setTags([])}
                                    className="text-[11px] text-slate-400 hover:text-red-600 font-medium transition-colors"
                                >
                                    Clear all
                                </button>
                            )}
                        </div>

                        {tags.length === 0 ? (
                            <div className="text-center py-7 bg-slate-50/70 rounded-xl border border-dashed border-slate-200">
                                <Tag className="w-7 h-7 text-slate-300 mx-auto mb-1.5" />
                                <p className="text-slate-600 text-xs font-medium">No compatible models yet</p>
                                <p className="text-slate-400 text-[11px] mt-0.5">Type above to associate compatible devices</p>
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto p-3 bg-slate-50/80 rounded-xl border border-slate-200/80">
                                {tags.map((tag) => (
                                    <span
                                        key={tag}
                                        className="inline-flex items-center gap-1.5 bg-white text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-lg text-xs font-medium shadow-xs"
                                    >
                                        <span>{tag}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeTag(tag)}
                                            className="text-slate-400 hover:text-red-500 rounded p-0.5 transition-colors cursor-pointer"
                                            title={`Remove ${tag}`}
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2.5">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={isSubmitting}
                        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-2 shadow-xs"
                    >
                        {isSubmitting ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                <span>Saving...</span>
                            </>
                        ) : (
                            <>
                                <CheckCircle className="w-4 h-4" />
                                <span>Save Changes</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SuitableModelsModal;
