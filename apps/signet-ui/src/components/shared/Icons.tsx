import {
  BarChart3,
  ClipboardList,
  Key,
  Smartphone,
  Settings,
  Pen,
  Lock,
  Unlock,
  Zap,
  CheckCircle,
  XCircle,
  PlusCircle,
  FileText,
  Copy,
  ChevronDown,
  AlertCircle,
  RefreshCw,
  Search,
  X,
  Trash2,
  Edit3,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Clock,
  type LucideProps,
} from 'lucide-react';

// Re-export icons with semantic names for the application
export {
  // Tab bar icons
  BarChart3 as DashboardIcon,
  ClipboardList as RequestsIcon,
  Key as KeyIcon,
  Smartphone as AppsIcon,
  Settings as SettingsIcon,

  // Method icons
  Pen as SignIcon,
  Lock as EncryptIcon,
  Unlock as DecryptIcon,
  Zap as OtherMethodIcon,

  // Activity icons
  CheckCircle as ApprovalIcon,
  XCircle as DenialIcon,
  PlusCircle as RegistrationIcon,
  FileText as ActivityIcon,

  // Action icons
  Copy as CopyIcon,
  ChevronDown as ChevronDownIcon,
  AlertCircle as ErrorIcon,
  RefreshCw as RefreshIcon,
  Search as SearchIcon,
  X as CloseIcon,
  Trash2 as DeleteIcon,
  Edit3 as EditIcon,

  // Trust level icons
  ShieldAlert as ParanoidIcon,
  Shield as ReasonableIcon,
  ShieldCheck as FullTrustIcon,

  // Stats/info icons
  Clock as HistoryIcon,
  Pen as SigningIcon,
};

// Icon props type for consumers
export type IconProps = LucideProps;

// Default icon size for consistency
export const DEFAULT_ICON_SIZE = 16;
export const LARGE_ICON_SIZE = 24;
export const SMALL_ICON_SIZE = 14;
