/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { sankey, sankeyLinkHorizontal, type SankeyNode as D3Node, type SankeyLink as D3Link } from 'd3-sankey'
import type { YearResult } from '../../api/client'

interface FlowSankeyProps {
  year: YearResult
}

interface NodeRow { id: string; label: string; group: 'inflow' | 'stock' | 'outflow' }

const COLORS = {
  inflow: 'var(--success)',
  stock: 'var(--mod-dsm)',
  outflow: 'var(--danger)',
}

// Resolve CSS variables to actual hex strings for d3 (which writes raw attrs).
function cssColor(varName: string): string {
  if (typeof window === 'undefined') return '#888'
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#888'
}

export function FlowSankey({ year }: FlowSankeyProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current) return
    const el = svgRef.current
    const W = el.clientWidth || 600
    const H = 320
    el.setAttribute('viewBox', `0 0 ${W} ${H}`)
    d3.select(el).selectAll('*').remove()

    const cohorts = Array.from(new Set([
      ...Object.keys(year.inflow),
      ...Object.keys(year.outflow),
      ...Object.keys(year.stock),
    ])).filter((ck) => (year.inflow[ck] ?? 0) + (year.outflow[ck] ?? 0) + (year.stock[ck] ?? 0) > 0)

    if (cohorts.length === 0) {
      d3.select(el).append('text')
        .attr('x', W / 2).attr('y', H / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#5A6577')
        .attr('font-size', 12)
        .text('No flows in this year.')
      return
    }

    const nodes: NodeRow[] = []
    nodes.push({ id: 'stock_total', label: `Stock ${year.year}`, group: 'stock' })
    cohorts.forEach((ck) => {
      if ((year.inflow[ck] ?? 0) > 0) nodes.push({ id: `in:${ck}`, label: `In ${ck}`, group: 'inflow' })
      if ((year.outflow[ck] ?? 0) > 0) nodes.push({ id: `out:${ck}`, label: `Out ${ck}`, group: 'outflow' })
    })

    const links: { source: string; target: string; value: number }[] = []
    cohorts.forEach((ck) => {
      const inAmt = year.inflow[ck] ?? 0
      const outAmt = year.outflow[ck] ?? 0
      if (inAmt > 0) links.push({ source: `in:${ck}`, target: 'stock_total', value: inAmt })
      if (outAmt > 0) links.push({ source: 'stock_total', target: `out:${ck}`, value: outAmt })
    })

    if (links.length === 0) {
      d3.select(el).append('text')
        .attr('x', W / 2).attr('y', H / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#5A6577')
        .attr('font-size', 12)
        .text(`Stock only — no inflows or outflows in ${year.year}.`)
      return
    }

    type N = D3Node<NodeRow, object>
    type L = D3Link<NodeRow, object>

    const layout = sankey<NodeRow, object>()
      .nodeId((d) => d.id)
      .nodeWidth(18)
      .nodePadding(8)
      .extent([[10, 10], [W - 110, H - 10]])

    let graph: { nodes: N[]; links: L[] }
    try {
      graph = layout({
        nodes: nodes.map((n) => ({ ...n })) as N[],
        links: links.map((l) => ({ ...l, value: Math.max(l.value, 0.0001) })) as L[],
      })
    } catch {
      return
    }

    const colorMap = {
      inflow: cssColor('--success'),
      stock: cssColor('--mod-dsm'),
      outflow: cssColor('--danger'),
    }

    const svg = d3.select(el)

    svg.append('g').selectAll('path')
      .data(graph.links)
      .join('path')
        .attr('d', sankeyLinkHorizontal())
        .attr('stroke', (d) => colorMap[(d.source as N).group])
        .attr('stroke-width', (d) => Math.max(1, d.width ?? 1))
        .attr('fill', 'none')
        .attr('opacity', 0.4)
        .on('mouseover', function () { d3.select(this).attr('opacity', 0.75) })
        .on('mouseout', function () { d3.select(this).attr('opacity', 0.4) })
      .append('title').text((d) => `${(d.source as N).label} → ${(d.target as N).label}\n${(d.value ?? 0).toFixed(2)}`)

    const nodeGroup = svg.append('g').selectAll('g')
      .data(graph.nodes)
      .join('g')
        .attr('transform', (d) => `translate(${d.x0 ?? 0},${d.y0 ?? 0})`)

    nodeGroup.append('rect')
      .attr('height', (d) => Math.max(2, (d.y1 ?? 0) - (d.y0 ?? 0)))
      .attr('width', (d) => (d.x1 ?? 0) - (d.x0 ?? 0))
      .attr('fill', (d) => colorMap[d.group])
      .attr('rx', 2)

    nodeGroup.append('text')
      .attr('x', (d) => ((d.x1 ?? 0) - (d.x0 ?? 0)) + 6)
      .attr('y', (d) => ((d.y1 ?? 0) - (d.y0 ?? 0)) / 2)
      .attr('dy', '0.35em')
      .attr('font-size', 11)
      .attr('fill', cssColor('--text-secondary'))
      .text((d) => d.label.length > 22 ? d.label.slice(0, 20) + '…' : d.label)
  }, [year])

  return (
    <div style={{ width: '100%', height: 320 }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        <Legend color={COLORS.inflow} label="Inflow" />
        <Legend color={COLORS.stock} label="Stock" />
        <Legend color={COLORS.outflow} label="Outflow" />
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, backgroundColor: color }} /> {label}
    </span>
  )
}
