import { useState, useEffect } from "react";
import {
  ArrowLeft, Calendar, User, BarChart, List, Filter,
  Clock, CheckCircle, FileText, DownloadIcon, RefreshCw,
  Award, TrendingUp, FileCheck, PieChart, Activity
} from "lucide-react";
import { ActivityBackfiller } from "@/components/crm/ActivityBackfiller";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart as ChartBar,
  Bar,
  LineChart,
  Line,
  PieChart as ChartPie,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

import { ActivityRecord, ActivitySummary, getWorkspaceActivities, getActivitySummary, generateActivityNarrative } from "@/lib/activityTrackingService";
import { useAuth } from "@/contexts/AuthContext";
import { CalendarDateRangePicker } from "@/components/ui/date-range-picker";
import { formatDistanceToNow } from "date-fns";

interface Props {
  onClose: () => void;
}

const ACTIVITY_COLORS = {
  task_created: "#6366f1",
  task_updated: "#8b5cf6",
  task_completed: "#22c55e",
  task_status_changed: "#3b82f6",
  form_submitted: "#f59e0b",
  invoice_created: "#ef4444",
  invoice_updated: "#f97316",
  invoice_paid: "#10b981",
  quote_created: "#06b6d4",
  quote_updated: "#0ea5e9", 
  quote_approved: "#14b8a6",
  inventory_updated: "#ec4899",
  comment_added: "#6b7280",
  user_logged_in: "#475569",
  user_logged_out: "#64748b",
};

export function ActivityReportPage({ onClose }: Props) {
  const { workspaceId, members } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedUserId, setSelectedUserId] = useState<string | "all">("all");
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
    to: new Date()
  });
  const [activityRecords, setActivityRecords] = useState<ActivityRecord[]>([]);
  const [activitySummaries, setActivitySummaries] = useState<ActivitySummary[]>([]);
  const [groupBy, setGroupBy] = useState<"user" | "date" | "activity">("user");

  // Load activities
  useEffect(() => {
    if (!workspaceId) return;
    
    setLoading(true);
    
    const startDate = dateRange.from.toISOString();
    const endDate = dateRange.to.toISOString();
    
    // Generate activity summaries before loading data to ensure they're up to date
    const regenerateSummaries = async () => {
      try {
        // Generate summaries for all days in the date range
        const startDay = new Date(dateRange.from);
        const endDay = new Date(dateRange.to);
        const days = [];
        
        // Create an array of dates to process
        for (let d = new Date(startDay); d <= endDay; d.setDate(d.getDate() + 1)) {
          days.push(new Date(d).toISOString().split('T')[0]);
        }
        
        // Generate summaries for each day - only if selectedUserId is specific
        if (selectedUserId !== "all") {
          for (const day of days) {
            await supabase.rpc('generate_user_activity_summary', {
              p_workspace_id: workspaceId,
              p_user_id: selectedUserId,
              p_date: day
            });
          }
        }
      } catch (error) {
        console.error("Error regenerating summaries:", error);
      }
    };
    
    // Run the regeneration and then load data
    regenerateSummaries().then(() => {
      Promise.all([
        getWorkspaceActivities(workspaceId, startDate, endDate),
        getActivitySummary(
          workspaceId,
          dateRange.from.toISOString().split('T')[0],
          dateRange.to.toISOString().split('T')[0],
        ),
      ]).then(([activities, summaries]) => {
        // Filter by selected user if needed
        const filteredActivities = selectedUserId === "all"
          ? activities
          : activities.filter(a => a.userId === selectedUserId);
        
        const filteredSummaries = selectedUserId === "all"
          ? summaries
          : summaries.filter(s => s.userId === selectedUserId);
        
        setActivityRecords(filteredActivities);
        setActivitySummaries(filteredSummaries);
        setLoading(false);
      }).catch(error => {
        console.error("Error loading activity data:", error);
        setLoading(false);
      });
    });
  }, [workspaceId, selectedUserId, dateRange]);

  // Prepare chart data according to groupBy
  const chartData = (() => {
    if (groupBy === "user") {
      // Group activities by user
      const userGroups = new Map();
      
      activityRecords.forEach(record => {
        if (!userGroups.has(record.userName)) {
          userGroups.set(record.userName, { name: record.userName, count: 0 });
        }
        userGroups.get(record.userName).count++;
      });
      
      return Array.from(userGroups.values());
    } else if (groupBy === "date") {
      // Group activities by date
      const dateGroups = new Map();
      
      activityRecords.forEach(record => {
        const date = new Date(record.activityDate).toLocaleDateString();
        if (!dateGroups.has(date)) {
          dateGroups.set(date, { name: date, count: 0 });
        }
        dateGroups.get(date).count++;
      });
      
      return Array.from(dateGroups.values());
    } else {
      // Group by activity type
      const activityGroups = new Map();
      
      activityRecords.forEach(record => {
        // Make activity type human readable
        const activityName = record.activityType
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
          
        if (!activityGroups.has(activityName)) {
          activityGroups.set(activityName, { 
            name: activityName,
            count: 0,
            color: ACTIVITY_COLORS[record.activityType] || "#6366f1"
          });
        }
        activityGroups.get(activityName).count++;
      });
      
      return Array.from(activityGroups.values());
    }
  })();

  // Calculate summary statistics
  const userStats = activitySummaries.reduce((acc, summary) => {
    if (!acc[summary.userId]) {
      acc[summary.userId] = {
        userId: summary.userId,
        userName: summary.userName,
        tasksCreated: 0,
        tasksCompleted: 0,
        totalActivities: 0
      };
    }
    
    acc[summary.userId].tasksCreated += summary.tasksCreated;
    acc[summary.userId].tasksCompleted += summary.tasksCompleted;
    acc[summary.userId].totalActivities += summary.totalActivities;
    
    return acc;
  }, {} as Record<string, { 
    userId: string;
    userName: string;
    tasksCreated: number;
    tasksCompleted: number;
    totalActivities: number;
  }>);

  // Calculate productivity scores
  const productivityScores = Object.values(userStats).map(user => ({
    name: user.userName,
    score: user.tasksCompleted * 3 + user.tasksCreated,
    completed: user.tasksCompleted,
    created: user.tasksCreated,
  })).sort((a, b) => b.score - a.score);

  // Generate activity feed (most recent activities)
  const activityFeed = activityRecords
    .slice(0, 20)
    .map(activity => {
      let icon;
      let description;
      
      switch(activity.activityType) {
        case 'task_created':
          icon = <FileText className="h-4 w-4 text-indigo-400" />;
          description = `created task "${activity.entityTitle || 'Unnamed task'}"`;
          break;
        case 'task_completed':
          icon = <CheckCircle className="h-4 w-4 text-green-400" />;
          description = `completed task "${activity.entityTitle || 'Unnamed task'}"`;
          break;
        case 'task_updated':
          icon = <FileCheck className="h-4 w-4 text-blue-400" />;
          description = `updated task "${activity.entityTitle || 'Unnamed task'}"`;
          break;
        case 'invoice_created':
          icon = <FileText className="h-4 w-4 text-red-400" />;
          description = `created invoice "${activity.entityTitle || activity.entityId || 'New invoice'}"`;
          break;
        case 'quote_created':
          icon = <FileText className="h-4 w-4 text-cyan-400" />;
          description = `created quote "${activity.entityTitle || activity.entityId || 'New quote'}"`;
          break;
        default:
          icon = <Activity className="h-4 w-4 text-muted-foreground" />;
          description = activity.activityType.replace(/_/g, ' ');
      }
      
      return {
        id: activity.id,
        user: activity.userName,
        time: formatDistanceToNow(new Date(activity.activityDate), { addSuffix: true }),
        icon,
        description
      };
    });

  // Generate daily summaries for each user
  const userSummaries = Object.values(userStats).map(user => {
    const userActivities = activityRecords.filter(a => a.userId === user.userId);
    return {
      userId: user.userId,
      userName: user.userName,
      summary: generateActivityNarrative(userActivities),
    };
  });

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col overflow-hidden">
      {/* Activity Debug Tool - shown if no activities are found */}
      {activityRecords.length === 0 && !loading && (
        <div className="px-6 py-2 bg-card">
          <ActivityBackfiller />
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-card border-b border-border shrink-0">
        <Button variant="ghost" size="icon" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-indigo-400" />
          <span className="text-lg font-semibold text-foreground">Activity Reports</span>
        </div>

        <div className="ml-auto flex items-center gap-4">
          {/* User Filter */}
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <Select
              value={selectedUserId}
              onValueChange={value => setSelectedUserId(value)}
            >
              <SelectTrigger className="h-8 min-w-[180px] bg-card border-border">
                <SelectValue placeholder="Select user" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {members.map(member => (
                  <SelectItem key={member.uid} value={member.uid}>
                    {member.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date Range Picker */}
          <CalendarDateRangePicker
            date={{ from: dateRange.from, to: dateRange.to }}
            onUpdate={setDateRange}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs 
          value={activeTab} 
          onValueChange={setActiveTab} 
          className="flex-1 flex flex-col"
        >
          <div className="px-6 pt-4 border-b border-border">
            <TabsList className="w-full bg-card">
              <TabsTrigger value="overview" className="flex-1">
                <BarChart className="h-4 w-4 mr-2" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="users" className="flex-1">
                <User className="h-4 w-4 mr-2" />
                User Reports
              </TabsTrigger>
              <TabsTrigger value="feed" className="flex-1">
                <List className="h-4 w-4 mr-2" />
                Activity Feed
              </TabsTrigger>
            </TabsList>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <RefreshCw className="h-8 w-8 text-indigo-400 animate-spin" />
            </div>
          ) : (
            <>
              {/* Overview Tab */}
              <TabsContent value="overview" className="flex-1 overflow-auto p-6 space-y-6">
                {/* Stats Cards Row */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">Total Activities</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{activityRecords.length}</div>
                      <p className="text-xs text-muted-foreground mt-1">
                        In selected date range
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">Tasks Created</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-indigo-400">
                        {activityRecords.filter(a => a.activityType === 'task_created').length}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        New tasks in the system
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">Tasks Completed</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-500">
                        {activityRecords.filter(a => a.activityType === 'task_completed').length}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Tasks marked as complete
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">Active Users</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-blue-400">
                        {new Set(activityRecords.map(a => a.userId)).size}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Users with tracked activities
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Activity Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="bg-card border-border">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle>Activity Distribution</CardTitle>
                        <Select 
                          value={groupBy} 
                          onValueChange={value => setGroupBy(value as "user" | "date" | "activity")}
                        >
                          <SelectTrigger className="h-8 w-32 bg-card border-border">
                            <SelectValue placeholder="Group by" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">By User</SelectItem>
                            <SelectItem value="date">By Date</SelectItem>
                            <SelectItem value="activity">By Activity</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <CardDescription>
                        Activity distribution {groupBy === "user" ? "per user" : groupBy === "date" ? "over time" : "by type"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {groupBy === "activity" ? (
                        <ResponsiveContainer width="100%" height={300}>
                          <ChartPie>
                            <Pie
                              data={chartData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                              outerRadius={100}
                              fill="#8884d8"
                              dataKey="count"
                            >
                              {chartData.map((entry, index) => (
                                <Cell 
                                  key={`cell-${index}`} 
                                  fill={entry.color || ACTIVITY_COLORS[Object.keys(ACTIVITY_COLORS)[index % Object.keys(ACTIVITY_COLORS).length]]}
                                />
                              ))}
                            </Pie>
                            <Tooltip />
                            <Legend />
                          </ChartPie>
                        </ResponsiveContainer>
                      ) : (
                        <ResponsiveContainer width="100%" height={300}>
                          <ChartBar data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                            <XAxis 
                              dataKey="name" 
                              tick={{fill: '#94a3b8'}}
                              tickFormatter={value => 
                                value.length > 12 ? `${value.substring(0, 12)}...` : value
                              } 
                            />
                            <YAxis tick={{fill: '#94a3b8'}} />
                            <Tooltip 
                              contentStyle={{
                                backgroundColor: '#1e293b',
                                border: '1px solid #334155'
                              }}
                            />
                            <Bar 
                              dataKey="count" 
                              name="Activities" 
                              fill="#6366f1" 
                              radius={[4, 4, 0, 0]} 
                            />
                          </ChartBar>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="bg-card border-border">
                    <CardHeader>
                      <CardTitle>Top Performers</CardTitle>
                      <CardDescription>
                        Users ranked by productivity score
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {productivityScores.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground">
                          No activity data available
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height={300}>
                          <ChartBar 
                            data={productivityScores.slice(0, 5)}
                            layout="vertical"
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#444" horizontal={false} />
                            <XAxis type="number" tick={{fill: '#94a3b8'}} />
                            <YAxis 
                              dataKey="name" 
                              type="category"
                              tick={{fill: '#94a3b8'}}
                              width={100}
                            />
                            <Tooltip 
                              contentStyle={{
                                backgroundColor: '#1e293b',
                                border: '1px solid #334155'
                              }}
                            />
                            <Bar 
                              dataKey="created" 
                              name="Tasks Created" 
                              stackId="a"
                              fill="#6366f1" 
                            />
                            <Bar 
                              dataKey="completed" 
                              name="Tasks Completed" 
                              stackId="a"
                              fill="#22c55e" 
                            />
                            <Legend />
                          </ChartBar>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Secondary Charts */}
                <div className="grid grid-cols-1 gap-6">
                  <Card className="bg-card border-border">
                    <CardHeader>
                      <CardTitle>Activity Timeline</CardTitle>
                      <CardDescription>
                        Daily activity counts over the selected period
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart 
                          data={
                            // Group by date
                            Array.from(
                              activityRecords.reduce((acc, record) => {
                                const date = new Date(record.activityDate).toLocaleDateString();
                                if (!acc.has(date)) {
                                  acc.set(date, { 
                                    date,
                                    count: 0,
                                    tasksCreated: 0,
                                    tasksCompleted: 0,
                                  });
                                }
                                acc.get(date).count++;
                                
                                if (record.activityType === 'task_created') {
                                  acc.get(date).tasksCreated++;
                                }
                                
                                if (record.activityType === 'task_completed') {
                                  acc.get(date).tasksCompleted++;
                                }
                                
                                return acc;
                              }, new Map())
                            ).map(e => e[1])
                          }
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                          <XAxis dataKey="date" tick={{fill: '#94a3b8'}} />
                          <YAxis tick={{fill: '#94a3b8'}} />
                          <Tooltip 
                            contentStyle={{
                              backgroundColor: '#1e293b',
                              border: '1px solid #334155'
                            }}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="count" 
                            name="All Activities" 
                            stroke="#6366f1" 
                            strokeWidth={2}
                            dot={{ r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="tasksCreated" 
                            name="Tasks Created" 
                            stroke="#8b5cf6" 
                            strokeWidth={2}
                            dot={{ r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="tasksCompleted" 
                            name="Tasks Completed" 
                            stroke="#22c55e" 
                            strokeWidth={2}
                            dot={{ r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                          <Legend />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* User Reports Tab */}
              <TabsContent value="users" className="flex-1 overflow-auto p-6 space-y-6">
                {userSummaries.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <User className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p className="text-lg">No user data available</p>
                    <p className="text-sm">Adjust your filters or date range to see user activity.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {userSummaries.map(summary => (
                      <Card key={summary.userId} className="bg-card border-border">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <User className="h-5 w-5 text-indigo-400" />
                            {summary.userName}
                          </CardTitle>
                          <CardDescription>
                            Activity summary for {dateRange.from.toLocaleDateString()} - {dateRange.to.toLocaleDateString()}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="bg-background rounded-md p-4 text-sm whitespace-pre-line">
                            {summary.summary}
                          </div>
                          
                          <div className="mt-4 grid grid-cols-3 gap-2">
                            <div className="bg-background p-3 rounded-md text-center">
                              <div className="text-sm text-muted-foreground">Created</div>
                              <div className="text-xl font-bold text-indigo-400 mt-1">
                                {activityRecords.filter(a => 
                                  a.userId === summary.userId && 
                                  a.activityType === 'task_created'
                                ).length}
                              </div>
                            </div>
                            
                            <div className="bg-background p-3 rounded-md text-center">
                              <div className="text-sm text-muted-foreground">Completed</div>
                              <div className="text-xl font-bold text-green-400 mt-1">
                                {activityRecords.filter(a => 
                                  a.userId === summary.userId && 
                                  a.activityType === 'task_completed'
                                ).length}
                              </div>
                            </div>
                            
                            <div className="bg-background p-3 rounded-md text-center">
                              <div className="text-sm text-muted-foreground">Total</div>
                              <div className="text-xl font-bold text-foreground mt-1">
                                {activityRecords.filter(a => a.userId === summary.userId).length}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Activity Feed Tab */}
              <TabsContent value="feed" className="flex-1 overflow-auto p-6">
                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle>Recent Activities</CardTitle>
                    <CardDescription>
                      Latest actions performed by users
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {activityFeed.length === 0 ? (
                      <div className="text-center py-10 text-muted-foreground">
                        <Activity className="h-12 w-12 mx-auto mb-3 opacity-20" />
                        <p className="text-lg">No activities in the selected period</p>
                        <p className="text-sm">Adjust your filters or date range to see activity.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {activityFeed.map(activity => (
                          <div key={activity.id} className="flex border-b border-border pb-3 last:border-b-0 last:pb-0">
                            <div className="mr-3 mt-0.5">
                              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                                {activity.icon}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <div className="text-sm">
                                <span className="font-medium text-foreground">{activity.user}</span>{' '}
                                <span className="text-muted-foreground">{activity.description}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">{activity.time}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </div>
  );
}