import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase, supabaseServiceRole } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

/**
 * A utility component to generate sample activities for the current user
 * Only visible to admins or for debugging
 */
export function ActivityBackfiller() {
  const { user, workspaceId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  
  if (!user || !workspaceId) return null;
  
  async function generateSampleActivities() {
    if (!user || !workspaceId) return;
    
    setLoading(true);
    setMessage('Generating sample activities...');
    
    try {
      // Generate recent activities for inventory, tasks, etc.
      const now = new Date();
      const activities = [
        // Today's activities
        {
          workspace_id: workspaceId,
          user_id: user.uid,
          activity_type: 'inventory_updated',
          activity_date: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
          entity_type: 'inventory',
          entity_id: 'inv_' + Date.now() + '_1',
          entity_title: 'Product 1',
          metadata: { changeType: 'price', previousValues: { price: 99.99 }, newValues: { price: 129.99 } }
        },
        {
          workspace_id: workspaceId,
          user_id: user.uid,
          activity_type: 'task_updated',
          activity_date: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
          entity_type: 'task',
          entity_id: 't' + Date.now() + '_1',
          entity_title: 'Fix Customer Issue',
          metadata: { changes: ['status'] }
        },
        // Yesterday's activities
        {
          workspace_id: workspaceId,
          user_id: user.uid,
          activity_type: 'task_created',
          activity_date: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
          entity_type: 'task',
          entity_id: 't' + Date.now() + '_2',
          entity_title: 'New Customer Request',
          metadata: {}
        },
        {
          workspace_id: workspaceId,
          user_id: user.uid,
          activity_type: 'inventory_updated',
          activity_date: new Date(now.getTime() - (24 + 3) * 60 * 60 * 1000).toISOString(),
          entity_type: 'inventory',
          entity_id: 'inv_' + Date.now() + '_2',
          entity_title: 'Product 2',
          metadata: { changeType: 'stock_added', previousQuantity: 5, newQuantity: 10 }
        },
        // 2 days ago
        {
          workspace_id: workspaceId,
          user_id: user.uid,
          activity_type: 'task_completed',
          activity_date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          entity_type: 'task',
          entity_id: 't' + Date.now() + '_3',
          entity_title: 'Urgent Repair',
          metadata: {}
        },
        {
          workspace_id: workspaceId,
          user_id: user.uid,
          activity_type: 'user_logged_in',
          activity_date: new Date(now.getTime() - (2 * 24 + 1) * 60 * 60 * 1000).toISOString(),
          entity_type: 'user',
          entity_id: user.uid,
          entity_title: user.displayName || user.email,
          metadata: {}
        }
      ];
      
      let successCount = 0;
      let errorCount = 0;
      
      // Insert activities one by one to avoid batch errors
      for (const activity of activities) {
        const { error } = await supabaseServiceRole.from('user_activities').insert(activity);
        
        if (error) {
          errorCount++;
          console.error('Error inserting activity:', error);
        } else {
          successCount++;
        }
      }
      
      // Generate summaries for the activity dates
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 3);
      
      // Generate all days in range
      const dates = [];
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        dates.push(new Date(d).toISOString().split('T')[0]);
      }
      
      // Generate summaries for each day
      for (const date of dates) {
        await supabase.rpc('generate_user_activity_summary', {
          p_workspace_id: workspaceId,
          p_user_id: user.uid,
          p_date: date
        }).catch(error => {
          console.error(`Error generating summary for ${date}:`, error);
        });
      }
      
      setMessage(`Generated ${successCount} sample activities with ${errorCount} errors. Summaries generated for ${dates.length} days.`);
    } catch (error) {
      console.error('Error generating sample activities:', error);
      setMessage(`Error generating activities: ${(error as any).message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mb-4 border-orange-300 bg-orange-50 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-orange-800">Activity Debug Tool</CardTitle>
        <CardDescription className="text-xs text-orange-700">
          Generate sample activities for the current user to populate activity reports.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {message && (
          <div className="mb-3 text-xs text-orange-700 bg-orange-100 p-2 rounded">
            {message}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button 
          size="sm" 
          variant="outline"
          onClick={generateSampleActivities}
          disabled={loading}
          className="bg-white border-orange-400 text-orange-800 hover:bg-orange-100"
        >
          {loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          Generate Sample Activities
        </Button>
      </CardFooter>
    </Card>
  );
}