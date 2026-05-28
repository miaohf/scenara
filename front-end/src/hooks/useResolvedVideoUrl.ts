import { useEffect, useState } from 'react';
import { isOpfsVideoRef, resolveVideoPlaybackSrc } from '../services/videoStorageService';

export const useResolvedVideoUrl = (videoUrl?: string): string | undefined => {
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(() => {
    if (!videoUrl || isOpfsVideoRef(videoUrl)) return undefined;
    return videoUrl;
  });

  useEffect(() => {
    let cancelled = false;
    let revoke: (() => void) | undefined;

    if (!videoUrl) {
      setResolvedUrl(undefined);
      return () => undefined;
    }

    if (!isOpfsVideoRef(videoUrl)) {
      setResolvedUrl(videoUrl);
      return () => undefined;
    }

    // Avoid binding custom OPFS scheme to <video src> before resolving.
    setResolvedUrl(undefined);

    resolveVideoPlaybackSrc(videoUrl)
      .then(result => {
        if (cancelled) {
          result.revoke?.();
          return;
        }
        revoke = result.revoke;
        setResolvedUrl(result.src || undefined);
      })
      .catch(error => {
        console.warn('Failed to resolve video playback source.', error);
        if (!cancelled) {
          setResolvedUrl(undefined);
        }
      });

    return () => {
      cancelled = true;
      if (revoke) {
        revoke();
      }
    };
  }, [videoUrl]);

  return resolvedUrl;
};
