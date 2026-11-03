import { formatDate } from "@/lib/logic/dates";

interface WeightPoint {
  measured_at: string;
  weight_kg: number;
}

/** Curva de peso en SVG (sin librerías). Puntos ordenados por fecha. */
export function WeightChart({ points }: { points: WeightPoint[] }) {
  if (points.length === 0) return null;

  const width = 480;
  const height = 220;
  // Espacio arriba para la unidad (kg), que va aparte de los números del eje.
  const pad = { top: 30, right: 20, bottom: 36, left: 46 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const times = points.map((p) => new Date(`${p.measured_at}T00:00:00Z`).getTime());
  const weights = points.map((p) => Number(p.weight_kg));
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const spanW = maxW - minW || 1;
  const yMin = minW - spanW * 0.15;
  const yMax = maxW + spanW * 0.15;

  const x = (t: number) => pad.left + (maxT === minT ? innerW / 2 : ((t - minT) / (maxT - minT)) * innerW);
  const y = (w: number) => pad.top + innerH - ((w - yMin) / (yMax - yMin)) * innerH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(times[i]).toFixed(1)},${y(weights[i]).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Curva de peso del paciente" className="h-auto w-full max-w-2xl">
      {[0, 0.5, 1].map((f) => {
        const value = yMin + (yMax - yMin) * f;
        return (
          <g key={f}>
            <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={pad.left - 6} y={y(value) + 4} textAnchor="end" fontSize="12" fill="#64748b">
              {value.toFixed(1)}
            </text>
          </g>
        );
      })}
      <path d={path} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={`${p.measured_at}-${i}`}>
          <circle cx={x(times[i])} cy={y(weights[i])} r="4" fill="var(--color-primary)" />
          <title>{`${formatDate(p.measured_at)}: ${p.weight_kg} kg`}</title>
        </g>
      ))}
      {points.length === 1 ? (
        <text x={width / 2} y={height - 10} textAnchor="middle" fontSize="12" fill="#64748b">
          {formatDate(points[0].measured_at)}
        </text>
      ) : (
        <>
          <text x={pad.left} y={height - 10} fontSize="12" fill="#64748b">
            {formatDate(points[0].measured_at)}
          </text>
          <text x={width - pad.right} y={height - 10} textAnchor="end" fontSize="12" fill="#64748b">
            {formatDate(points[points.length - 1].measured_at)}
          </text>
        </>
      )}
      <text x={pad.left - 6} y={14} textAnchor="end" fontSize="12" fontWeight="600" fill="#64748b">
        kg
      </text>
    </svg>
  );
}
