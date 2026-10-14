import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
const buttonVariants = cva('button', {
  variants: { variant: { default: 'button-primary', outline: 'button-outline', ghost: 'button-ghost', destructive: 'button-danger' }, size: { default: '', sm: 'button-sm', icon: 'button-icon' } },
  defaultVariants: { variant: 'default', size: 'default' },
});
export function Button({ className, variant, size, asChild = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
