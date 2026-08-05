import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwindクラス名を条件付きで結合し、重複・競合するユーティリティクラスを解決する */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
