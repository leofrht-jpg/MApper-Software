import { useRef } from 'react'
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts'
import { type ContributionItem } from '../../api/client'
import { ChartExportButton } from './ChartExportButton'
import { ChartExportContainer } from './ChartExportContainer'

const CHART_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
]

interface Props {
  items: ContributionItem[]
  restAmount: number
  restPercentage: number
  unit: string
  exportFilename?: string
}

// Recharts Treemap requires inline colors via content prop
function CustomTreemapContent(props: {
  x?: number; y?: number; width?: number; height?: number
  name?: string; value?: number; depth?: number; index?: number
}) {
  const { x = 0, y = 0, width = 0, height = 0, name = '', index = 0 } = props
  if (width < 10 || height < 10) return null
  const color = index < CHART_COLORS.length
    ? ['#3ECFCF','#A78BFA','#F59E0B','#F87171','#34D399','#60A5FA','#FB923C','#E879F9'][index % 8]
    : '#3A4050'
  const showLabel = width > 60 && height > 30

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.8} rx={4} stroke="#12161B" strokeWidth={2} />
      {showLabel && (
        <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="middle" fill="#E8ECF1" fontSize={11} fontFamily="inherit">
          <tspan x={x + width / 2} dy="-0.5em">{(name || '').slice(0, 20)}</tspan>
        </text>
      )}
    </g>
  )
}

export function ContributionTreemap({ items, restAmount, restPercentage, unit, exportFilename }: Props) {
  const data = [
    ...items.map((item) => ({ name: item.activity_name, value: Math.abs(item.percentage), amount: item.amount, unit })),
    ...(restPercentage > 0 ? [{ name: 'Other', value: Math.abs(restPercentage), amount: restAmount, unit }] : []),
  ]
  const treemapRef = useRef<HTMLDivElement>(null)

  return (
    <div style={{ position: 'relative' }}>
      {exportFilename && (
        <div style={{ position: 'absolute', top: 4, right: 4, zIndex: 5 }}>
          <ChartExportButton chartRef={treemapRef} filename={exportFilename} />
        </div>
      )}
      <ChartExportContainer ref={treemapRef} style={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={data}
            dataKey="value"
            content={<CustomTreemapContent />}
          >
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
              formatter={(value, _name, entry: { payload?: { amount?: number; unit?: string } }) => [
                `${((entry.payload?.amount) ?? 0).toExponential(3)} ${entry.payload?.unit ?? ''}`,
                `${Number(value).toFixed(1)}%`,
              ]}
            />
          </Treemap>
        </ResponsiveContainer>
      </ChartExportContainer>
    </div>
  )
}
