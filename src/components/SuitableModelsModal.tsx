import React, { useState, useEffect } from 'react';
import { X, Plus, CheckCircle } from 'lucide-react';
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

    // Handle input change and detect comma
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value.toUpperCase();

        // Check if comma is entered
        if (value.includes(',')) {
            // Split by comma and process each part
            const newTags = value
                .split(',')
                .map(tag => tag.trim())
                .filter(tag => tag.length > 0 && !tags.includes(tag));

            if (newTags.length > 0) {
                setTags([...tags, ...newTags]);
            }
            setInputValue('');
        } else {
            setInputValue(value);
        }
    };

    // Handle Enter key press
    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && inputValue.trim()) {
            e.preventDefault();
            const trimmedValue = inputValue.trim();
            if (!tags.includes(trimmedValue)) {
                setTags([...tags, trimmedValue]);
            }
            setInputValue('');
        }
    };

    // Remove a tag
    const removeTag = (tagToRemove: string) => {
        setTags(tags.filter(tag => tag !== tagToRemove));
    };

    // Add tag from button
    const addTag = () => {
        const trimmedValue = inputValue.trim();
        if (trimmedValue && !tags.includes(trimmedValue)) {
            setTags([...tags, trimmedValue]);
            setInputValue('');
        }
    };

    // Save suitable models to Firestore
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
        <div className="fixed inset-0 bg-transparent backdrop-blur-xl flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="bg-indigo-600 p-5 text-white">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <CheckCircle className="h-6 w-6" />
                            <div>
                                <h2 className="text-xl font-bold">Suitable Models</h2>
                                <p className="text-indigo-100 text-sm mt-0.5">Manage compatible models</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="hover:bg-white/20 rounded-full p-2 transition-colors"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {/* Product Info */}
                    <div className="bg-gray-50 rounded-lg p-4 mb-5 border border-gray-200">
                        <h3 className="font-semibold text-gray-900">{product.name}</h3>
                        <div className="flex flex-wrap gap-2 mt-2 text-sm text-gray-600">
                            <span>{product.brand}</span>
                            {product.model && <span>• {product.model}</span>}
                            <span>• {product.category}</span>
                        </div>
                    </div>

                    {/* Input Section */}
                    <div className="mb-5">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Add Compatible Models
                        </label>

                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={inputValue}
                                onChange={handleInputChange}
                                onKeyPress={handleKeyPress}
                                placeholder="Type model names..."
                                className="flex-1 px-4 py-2.5 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                autoFocus
                            />
                            <button
                                type="button"
                                onClick={addTag}
                                disabled={!inputValue.trim()}
                                className="bg-indigo-600 text-white px-4 py-2.5 rounded-lg hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                <Plus className="h-5 w-5" />
                                <span className="hidden sm:inline">Add</span>
                            </button>
                        </div>
                    </div>

                    {/* Tags Display */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Compatible Models ({tags.length})
                        </label>

                        {tags.length === 0 ? (
                            <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                                <CheckCircle className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                                <p className="text-gray-500 text-sm">No models added yet</p>
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-2 bg-gray-50 rounded-lg p-4 border border-gray-200">
                                {tags.map((tag, index) => (
                                    <div
                                        key={index}
                                        className="inline-flex items-center gap-2 bg-indigo-600 text-white px-3 py-1.5 rounded-lg shadow-sm hover:bg-indigo-700 transition-all"
                                    >
                                        <span className="font-medium text-sm">{tag}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeTag(tag)}
                                            className="hover:bg-white/20 rounded-full p-0.5 transition-colors"
                                            title="Remove"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="border-t border-gray-200 p-5 bg-gray-50">
                    <div className="flex gap-3 justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2.5 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-all font-medium"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSubmitting}
                            className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isSubmitting ? (
                                <>
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <CheckCircle className="h-5 w-5" />
                                    Save Models
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SuitableModelsModal;
