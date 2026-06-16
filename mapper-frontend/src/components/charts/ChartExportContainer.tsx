import { forwardRef, type CSSProperties, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  style?: CSSProperties
  className?: string
}

export const ChartExportContainer = forwardRef<HTMLDivElement, Props>(
  ({ children, style, className }, ref) => {
    return (
      <div ref={ref} className={className} style={{ width: '100%', height: '100%', ...style }}>
        {children}
      </div>
    )
  },
)

ChartExportContainer.displayName = 'ChartExportContainer'
