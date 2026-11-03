import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SequenceLoaderProps {
    loading?: boolean;
}

const SequenceLoader: React.FC<SequenceLoaderProps> = ({
    loading = true
}) => {
    const [currentFrame, setCurrentFrame] = useState(1);
    const totalFrames = 10;

    useEffect(() => {
        if (!loading) return;

        const interval = setInterval(() => {
            setCurrentFrame((prev) => (prev >= totalFrames ? 1 : prev + 1));
        }, 80); // Slightly faster for smoother animation (was 100ms)

        return () => clearInterval(interval);
    }, [loading]);

    // Preload all images
    useEffect(() => {
        const preloadImages = () => {
            for (let i = 1; i <= totalFrames; i++) {
                const img = new Image();
                img.src = `/sequenceLoader/${i}.png`;
            }
        };
        preloadImages();
    }, []);

    return (
        <AnimatePresence mode="wait">
            {loading && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="fixed inset-0 z-[9999] flex items-center justify-center"
                    style={{
                        backdropFilter: 'blur(24px)',
                        WebkitBackdropFilter: 'blur(24px)',
                        backgroundColor: 'transparent',
                    }}
                >
                    {/* Only the image sequence - no decorations, no fade between frames */}
                    <img
                        src={`/sequenceLoader/${currentFrame}.png`}
                        alt="Loading"
                        className="w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 object-contain"
                    />
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default SequenceLoader;
