import React from 'react';
import SequenceLoader from './SequenceLoader';

interface CustomLoaderProps {
  message?: string;
  loading?: boolean;
}

const CustomLoader: React.FC<CustomLoaderProps> = ({
  loading = true
}) => {
  return <SequenceLoader loading={loading} />;
};

export default CustomLoader;
