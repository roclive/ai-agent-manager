export function ProjectChip({ projectKey }: { projectKey: string }) {
  const hue =
    [...projectKey].reduce((n, c) => n * 31 + c.charCodeAt(0), 0) % 360;
  return (
    <span
      className="project-chip"
      style={{
        color: `hsl(${Math.abs(hue)} 65% 42%)`,
        backgroundColor: `hsl(${Math.abs(hue)} 65% 50% / .12)`,
      }}
    >
      {projectKey}
    </span>
  );
}
