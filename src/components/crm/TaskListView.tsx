import { memo } from "react";
import { Task, DEFAULT_STATUSES, PRIORITIES, CustomFieldDefinition, StatusConfig } from "@/types/crm";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Calendar } from "lucide-react";

interface TaskListViewProps {
  tasks: Task[];
  visibleFields: CustomFieldDefinition[];
  onSelectTask: (task: Task) => void;
  customStatuses?: StatusConfig[];
  selectedTaskIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

function getFieldValue(task: Task, fieldId: string) {
  const fv = (task.customFieldValues ?? []).find(v => v.fieldId === fieldId);
  return fv ? String(fv.value) : "—";
}

// ─── Memoized desktop row ────────────────────────────────────────────────────
const DesktopTaskRow = memo(function DesktopTaskRow({
  task, visibleFields, allStatuses, onSelect, isSelected, onToggle,
}: {
  task: Task;
  visibleFields: CustomFieldDefinition[];
  allStatuses: StatusConfig[];
  onSelect: (task: Task) => void;
  isSelected?: boolean;
  onToggle?: (id: string) => void;
}) {
  const status = allStatuses.find(s => s.id === task.status);
  const priority = PRIORITIES.find(p => p.value === task.priority);
  return (
    <TableRow
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onSelect(task)}
      className={cn("cursor-pointer hover:bg-accent/50", isSelected && "bg-primary/5")}
    >
      {onToggle && (
        <TableCell className="w-8 pl-3" onClick={e => { e.stopPropagation(); onToggle(task.id); }}>
          <Checkbox checked={!!isSelected} onCheckedChange={() => onToggle(task.id)} />
        </TableCell>
      )}
      <TableCell className="font-mono text-xs text-primary/80 font-semibold">{task.jobNumber ?? "—"}</TableCell>
      <TableCell className="font-medium text-sm">{task.title}</TableCell>
      <TableCell>
        {status && (
          <span className={cn("inline-flex px-2 py-0.5 rounded text-xs font-medium", status.color)}>
            {status.label}
          </span>
        )}
      </TableCell>
      <TableCell>
        {priority && (
          <Badge variant="outline" className="text-xs">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full mr-1", priority.color)} />
            {priority.label}
          </Badge>
        )}
      </TableCell>
      {visibleFields.map(f => (
        <TableCell key={f.id} className="text-sm text-muted-foreground">
          {getFieldValue(task, f.id)}
        </TableCell>
      ))}
      <TableCell className="text-sm text-muted-foreground">{task.createdAt}</TableCell>
    </TableRow>
  );
});

// ─── Memoized mobile card ────────────────────────────────────────────────────
const MobileTaskCard = memo(function MobileTaskCard({
  task, visibleFields, allStatuses, onSelect, isSelected, onToggle,
}: {
  task: Task;
  visibleFields: CustomFieldDefinition[];
  allStatuses: StatusConfig[];
  onSelect: (task: Task) => void;
  isSelected?: boolean;
  onToggle?: (id: string) => void;
}) {
  const status = allStatuses.find(s => s.id === task.status);
  const priority = PRIORITIES.find(p => p.value === task.priority);
  const fieldsToShow = visibleFields
    .map(f => ({ label: f.name, value: getFieldValue(task, f.id) }))
    .filter(f => f.value && f.value !== "—")
    .slice(0, 2);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onSelect(task)}
      className={cn("bg-card border border-border rounded-lg p-2.5 cursor-pointer hover:bg-accent/50 transition-colors touch-action-manipulation active:bg-accent", isSelected && "border-primary bg-primary/5")}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {onToggle && (
            <div onClick={e => { e.stopPropagation(); onToggle(task.id); }}>
              <Checkbox checked={!!isSelected} onCheckedChange={() => onToggle(task.id)} />
            </div>
          )}
          <span className="font-mono text-xs font-bold text-primary">{task.jobNumber ?? "—"}</span>
        </div>
        {priority && (
          <span className={cn("h-2 w-2 rounded-full shrink-0", priority.color)} title={priority.label} />
        )}
      </div>
      <h3 className="font-medium text-sm mb-1.5 leading-snug line-clamp-2">{task.title}</h3>
      <div className="flex items-center justify-between">
        {status && (
          <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium", status.color)}>
            {status.label}
          </span>
        )}
        <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {task.createdAt}
        </div>
      </div>
      {fieldsToShow.length > 0 && (
        <div className="space-y-0.5 mt-1.5 pt-1.5 border-t border-border/50">
          {fieldsToShow.map(f => (
            <div key={f.label} className="flex justify-between items-center">
              <span className="text-[10px] text-muted-foreground">{f.label}:</span>
              <span className="text-[10px] font-medium truncate ml-2">{f.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── Main exported component (memoized) ─────────────────────────────────────
export const TaskListView = memo(function TaskListView({
  tasks, visibleFields, onSelectTask, customStatuses, selectedTaskIds, onToggleSelect,
}: TaskListViewProps) {
  const allStatuses = customStatuses && customStatuses.length > 0 ? customStatuses : DEFAULT_STATUSES;
  const isMobile = useIsMobile();
  const allIds = tasks.map(t => t.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedTaskIds?.has(id));

  if (isMobile) {
    return (
      <div className="p-2 space-y-1.5 h-full overflow-auto">
        {tasks.map(task => (
          <MobileTaskCard
            key={task.id}
            task={task}
            visibleFields={visibleFields}
            allStatuses={allStatuses}
            onSelect={onSelectTask}
            isSelected={selectedTaskIds?.has(task.id)}
            onToggle={onToggleSelect}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 overflow-auto h-full">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {onToggleSelect && (
              <TableHead className="w-8 pl-3">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => {
                    if (checked) allIds.forEach(id => { if (!selectedTaskIds?.has(id)) onToggleSelect(id); });
                    else allIds.forEach(id => { if (selectedTaskIds?.has(id)) onToggleSelect(id); });
                  }}
                />
              </TableHead>
            )}
            <TableHead className="w-[90px]">Job No.</TableHead>
            <TableHead className="w-[300px]">Task</TableHead>
            <TableHead className="w-[110px]">Status</TableHead>
            <TableHead className="w-[100px]">Priority</TableHead>
            {visibleFields.map(f => (
              <TableHead key={f.id} className="w-[140px]">{f.name}</TableHead>
            ))}
            <TableHead className="w-[100px]">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map(task => (
            <DesktopTaskRow
              key={task.id}
              task={task}
              visibleFields={visibleFields}
              allStatuses={allStatuses}
              onSelect={onSelectTask}
              isSelected={selectedTaskIds?.has(task.id)}
              onToggle={onToggleSelect}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
});
