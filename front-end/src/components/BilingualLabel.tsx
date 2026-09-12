import React from 'react';
import { useInterfaceLanguage } from '../contexts/InterfaceLanguageContext';

interface BilingualLabelProps {
  primary: string;
  secondary: string;
  mode?: 'inline' | 'stacked' | 'badge';
  className?: string;
}

/** Displays the label for the currently selected interface language. */
const BilingualLabel: React.FC<BilingualLabelProps> = ({
  primary,
  secondary,
  mode = 'inline',
  className = '',
}) => {
  const { language } = useInterfaceLanguage();

  const value = language === 'zh' ? primary : secondary;
  const modeClass = mode === 'stacked' ? 'flex min-w-0 leading-tight' : 'inline-flex items-baseline';
  return <span className={`${modeClass} ${className}`}>{value}</span>;
};

export default BilingualLabel;
