import {
  Activity, AlertTriangle, ClipboardCheck, Copy, FileSearch, ArrowLeft, ArrowRight, BadgeCheck, Box, CheckCircle2, Check, ChevronDown, ChevronRight, Clock3,
  Database, ExternalLink, FileText, Flag, Globe, House, Info, Link2, Lock, LogOut, Mail, MapPin, MessageSquare, Minus,
  PenLine, Plus, RefreshCw, Scale, Search, Send, Settings, ShieldCheck, Shield, ShoppingCart, Sparkles, Store, Trash2,
  Truck, Upload, User, Eye, X, Zap
} from 'lucide-react'

const ICONS = {
  home: House,
  box: Box,
  shield: Shield,
  'shield-check': ShieldCheck,
  scale: Scale,
  settings: Settings,
  store: Store,
  alert: AlertTriangle,
  info: Info,
  check: Check,
  'check-circle': CheckCircle2,
  verified: BadgeCheck,
  x: X,
  clock: Clock3,
  upload: Upload,
  file: FileText,
  truck: Truck,
  mail: Mail,
  sparkles: Sparkles,
  refresh: RefreshCw,
  external: ExternalLink,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  search: Search,
  logout: LogOut,
  plus: Plus,
  minus: Minus,
  lock: Lock,
  user: User,
  map: MapPin,
  message: MessageSquare,
  activity: Activity,
  database: Database,
  link: Link2,
  cart: ShoppingCart,
  trash: Trash2,
  edit: PenLine,
  send: Send,
  eye: Eye,
  flag: Flag,
  zap: Zap,
  globe: Globe,
  copy: Copy,
  copied: ClipboardCheck,
  'file-search': FileSearch
}

/** One icon set (Lucide) for the whole app, addressed by short names. */
export function Icon({ name, size = 20, strokeWidth = 1.75, className, title }) {
  const Glyph = ICONS[name] || Info
  return (
    <Glyph
      className={className}
      size={size}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth={size < 16}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      focusable="false"
    />
  )
}

export function BrandMark({ size = 30, light = false }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path fill={light ? '#ffffff' : '#003087'} d="M16 2 4 6.5v8.6c0 7.4 5.1 13.4 12 14.9 6.9-1.5 12-7.5 12-14.9V6.5z" />
      <path fill={light ? '#cfe1ff' : '#0070E0'} d="M16 2v28c6.9-1.5 12-7.5 12-14.9V6.5z" />
      <path fill="none" stroke={light ? '#003087' : '#fff'} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" d="m10.5 16.2 3.8 3.8 7.4-7.6" />
    </svg>
  )
}
