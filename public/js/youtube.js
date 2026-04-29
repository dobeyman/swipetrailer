let apiReadyPromise = null;

function loadYouTubeApi() {
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => reject(new Error('youtube_api_load_failed'));
    document.head.appendChild(tag);
    const existing = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (existing) existing();
      resolve(window.YT);
    };
    setTimeout(() => reject(new Error('youtube_api_timeout')), 10_000);
  });
  // Allow retry after a failed load (network glitch, adblocker, etc.)
  apiReadyPromise.catch(() => {
    apiReadyPromise = null;
  });
  return apiReadyPromise;
}

export async function mountPlayer(containerEl, videoKey, { onReady, onError, onStateChange: onStateChangeCb, autoplay = false, mute = 1 } = {}) {
  const YT = await loadYouTubeApi();
  return new Promise((resolve) => {
    const player = new YT.Player(containerEl, {
      videoId: videoKey,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: autoplay ? 1 : 0,
        controls: 0,
        disablekb: 1,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        fs: 0,
        iv_load_policy: 3,
        mute,
      },
      events: {
        onReady: () => {
          onReady?.(player);
          resolve(player);
        },
        onError: (e) => onError?.(e),
        onStateChange: (e) => {
          if (e.data === 0) player.seekTo(0);
          onStateChangeCb?.(e, player);
        },
      },
    });
  });
}

export function unmountPlayer(player) {
  try {
    player?.destroy?.();
  } catch { /* no-op */ }
}

export function play(player) {
  try { player?.playVideo?.(); } catch { /* no-op */ }
}

export function pause(player) {
  try { player?.pauseVideo?.(); } catch { /* no-op */ }
}

export function setMuted(player, muted) {
  try {
    if (muted) player?.mute?.();
    else player?.unMute?.();
  } catch { /* no-op */ }
}
