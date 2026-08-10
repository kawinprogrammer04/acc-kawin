interface PageHeaderProps {
  title: string;
  description?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, subtitle, actions, children }: PageHeaderProps) {
  const desc = subtitle ?? description;
  const actionSlot = children ?? actions;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-white px-4 py-4 md:px-6">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {desc && <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>}
      </div>
      {actionSlot && <div className="flex flex-wrap items-center gap-2">{actionSlot}</div>}
    </div>
  );
}
