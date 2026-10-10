export interface WidgetProps {
  label: string;
  n: number;
}

/** A component so the fixture exercises JSX, not just module syntax. */
export function Widget(props: WidgetProps) {
  return <div className="widget">{"widget-rendered:" + props.label}</div>;
}
