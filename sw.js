// sw.js (서비스 워커)
self.addEventListener('install', (event) => {
    self.skipWaiting();
    console.log('[SW] 설치 완료');
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
    console.log('[SW] 활성화 완료');
});

// 크롬이 앱으로 인정하기 위한 필수 조건: fetch 이벤트 가로채기
self.addEventListener('fetch', (event) => {
    // 지금은 오프라인 캐싱 없이 그냥 네트워크로 통과시킵니다.
    event.respondWith(fetch(event.request).catch(() => {
        console.log('[SW] 오프라인 상태입니다.');
    }));
});