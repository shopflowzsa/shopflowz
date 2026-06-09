import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface CalendarDateRangePickerProps {
  date?: DateRange;
  onUpdate: (dateRange: DateRange) => void;
}

export function CalendarDateRangePicker({ date, onUpdate }: CalendarDateRangePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  const handleDateSelect = (selectedDate: DateRange | undefined) => {
    if (selectedDate?.from && selectedDate?.to) {
      onUpdate(selectedDate);
      // Close the popover if we have both from and to dates
      if (selectedDate.from && selectedDate.to) {
        setIsOpen(false);
      }
    }
  };

  // Predefined ranges
  const selectLastWeek = () => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);
    onUpdate({ from, to });
    setIsOpen(false);
  };

  const selectLastMonth = () => {
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - 1);
    onUpdate({ from, to });
    setIsOpen(false);
  };

  const selectThisMonth = () => {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), 1);
    onUpdate({ from, to });
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant="outline"
            size="sm"
            className="h-8 border-slate-600 bg-slate-700 text-white hover:text-slate-100 hover:bg-slate-600"
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "LLL dd, y")} - {format(date.to, "LLL dd, y")}
                </>
              ) : (
                format(date.from, "LLL dd, y")
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 bg-slate-800 border-slate-700 text-slate-200" align="start">
          <div className="p-2 flex gap-2 border-b border-slate-700">
            <Button variant="ghost" size="sm" onClick={selectLastWeek}>Last 7 days</Button>
            <Button variant="ghost" size="sm" onClick={selectThisMonth}>This month</Button>
            <Button variant="ghost" size="sm" onClick={selectLastMonth}>Last 30 days</Button>
          </div>
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={handleDateSelect}
            numberOfMonths={2}
            className="bg-slate-800 text-slate-300"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}