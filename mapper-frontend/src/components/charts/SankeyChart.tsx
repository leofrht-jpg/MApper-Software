import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { sankey, sankeyLinkHorizontal, type SankeyNode as D3SankeyNode, type SankeyLink as D3SankeyLink } from 'd3-sankey'
import { type SankeyData } from '../../api/client'

const CHART_COLORS = ['#3ECFCF','#A78BFA','#F59E0B','#F87171','#34D399','#60A5FA','#FB923C','#E879F9']

interface Props {
  data: SankeyData
}

type NodeDatum = D3SankeyNode<{ id: string; name: string; location: string }, object>
type LinkDatum = D3SankeyLink<{ id: string; name: string; location: string }, object>

export function SankeyChart({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || data.nodes.length === 0) return
    const el = svgRef.current
    const W = el.clientWidth || 700
    const H = el.clientHeight || 420
    const margin = { top: 10, right: 120, bottom: 10, left: 10 }

    d3.select(el).selectAll('*').remove()
    const svg = d3.select(el)

    const sankeyLayout = sankey<{ id: string; name: string; location: string }, object>()
      .nodeId((d) => d.id)
      .nodeWidth(20)
      .nodePadding(16)
      .extent([[margin.left, margin.top], [W - margin.right, H - margin.bottom]])

    const nodeMap = new Map(data.nodes.map((n) => [n.id, { ...n }]))
    const validLinks = data.links.filter((l) => nodeMap.has(l.source) && nodeMap.has(l.target))

    let graph: { nodes: NodeDatum[]; links: LinkDatum[] }
    try {
      graph = sankeyLayout({
        nodes: data.nodes.map((n) => ({ ...n })) as NodeDatum[],
        links: validLinks.map((l) => ({ source: l.source, target: l.target, value: l.value || 0.001 })) as LinkDatum[],
      })
    } catch {
      return
    }

    const colorScale = d3.scaleOrdinal(CHART_COLORS)

    // Links
    svg.append('g').selectAll('path')
      .data(graph.links)
      .join('path')
        .attr('d', sankeyLinkHorizontal())
        .attr('stroke', (d) => colorScale((d.source as NodeDatum).id))
        .attr('stroke-width', (d) => Math.max(1, d.width ?? 1))
        .attr('fill', 'none')
        .attr('opacity', 0.3)
        .on('mouseover', function () { d3.select(this).attr('opacity', 0.6) })
        .on('mouseout', function () { d3.select(this).attr('opacity', 0.3) })

    // Nodes
    const nodeGroup = svg.append('g').selectAll('g')
      .data(graph.nodes)
      .join('g')
        .attr('transform', (d) => `translate(${d.x0},${d.y0})`)

    nodeGroup.append('rect')
      .attr('height', (d) => Math.max(1, (d.y1 ?? 0) - (d.y0 ?? 0)))
      .attr('width', (d) => (d.x1 ?? 0) - (d.x0 ?? 0))
      .attr('fill', (d) => colorScale(d.id))
      .attr('rx', 3)
      .attr('stroke', '#2A3340')
      .attr('stroke-width', 1)

    // Labels
    nodeGroup.append('text')
      .attr('x', (d) => ((d.x1 ?? 0) - (d.x0 ?? 0)) + 6)
      .attr('y', (d) => ((d.y1 ?? 0) - (d.y0 ?? 0)) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'start')
      .attr('font-size', 11)
      .attr('fill', '#8B95A5')
      .attr('font-family', 'inherit')
      .text((d) => {
        const label = d.name.length > 28 ? d.name.slice(0, 26) + '…' : d.name
        return d.location ? `${label} [${d.location}]` : label
      })
  }, [data])

  return (
    <div style={{ height: 420, width: '100%', overflow: 'hidden' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
