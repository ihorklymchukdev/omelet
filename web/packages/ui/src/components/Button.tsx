import type { ButtonHTMLAttributes } from "react";
import { cx } from "../cx";
import s from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "lg";
}

export function Button({ variant = "secondary", size = "md", type = "button", className, ...rest }: ButtonProps) {
  return <button type={type} className={cx(s.button, s[size], s[variant], className)} {...rest} />;
}
