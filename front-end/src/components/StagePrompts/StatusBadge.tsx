import React from 'react';
import { STATUS_STYLES, STATUS_LABELS } from './constants';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

type Status = 'completed' | 'generating' | 'failed' | 'idle' | 'pending';

interface Props {
  status: Status;
  className?: string;
}

const StatusBadge: React.FC<Props> = ({ status, className = '' }) => {
  const { language } = useInterfaceLanguage();
  const normalizedStatus = status === 'pending' ? 'idle' : status;
  const statusClass = STATUS_STYLES[normalizedStatus];
  const label = STATUS_LABELS[normalizedStatus][language];

  return (
    <span className={`text-xs px-2 py-0.5 rounded ${statusClass} ${className}`}>
      {label}
    </span>
  );
};

export default StatusBadge;
