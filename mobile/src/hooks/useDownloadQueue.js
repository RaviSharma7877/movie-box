/**
 * Hook — manages persistent download queue synchronized with AsyncStorage.
 * Downloads NEVER disappear when navigating across screens or restarting the app.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  getQueue,
  enqueueDownload,
  pauseDownload,
  resumeDownload,
  deleteDownload,
  subscribeToQueue,
} from '../services/downloadManager';

export function useDownloadQueue() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  // Load persistent queue on mount & subscribe to live updates
  useEffect(() => {
    let mounted = true;

    getQueue().then((stored) => {
      if (mounted) {
        setQueue(stored);
        setLoading(false);
      }
    });

    const unsubscribe = subscribeToQueue((updatedQueue) => {
      if (mounted) {
        setQueue(updatedQueue);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const enqueue = useCallback(async (options) => {
    return await enqueueDownload(options);
  }, []);

  const pause = useCallback(async (id) => {
    await pauseDownload(id);
  }, []);

  const resume = useCallback(async (id) => {
    await resumeDownload(id);
  }, []);

  const remove = useCallback(async (id) => {
    await deleteDownload(id);
  }, []);

  return { queue, loading, enqueue, pause, resume, remove };
}
