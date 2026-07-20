"use client"

import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      style={
        {
          "--normal-bg": "rgba(10, 12, 18, 0.95)",
          "--normal-text": "#F0F0F0",
          "--normal-border": "rgba(170, 255, 0, 0.2)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
