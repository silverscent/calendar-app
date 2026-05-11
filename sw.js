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
    event.respondWith(
        fetch(event.request).catch((error) => {
            console.log('[SW] 네트워크 오류 또는 일시적인 오프라인 상태입니다.', error);
            
            // 🚨 핵심 해결책: null 대신 "503(서비스 일시 불가)" 상태의 가짜 응답을 정식으로 만들어서 던져줍니다.
            // 이렇게 하면 브라우저가 뻗지 않고 프론트엔드 코드에서 조용히 에러로 처리할 수 있습니다.
            return new Response(JSON.stringify({ success: false, error: "offline", msg: "네트워크가 끊겼거나 서비스 워커가 대기 중입니다." }), {
                status: 503,
                statusText: "Service Unavailable",
                headers: new Headers({ 'Content-Type': 'application/json' })
            });
        })
    );
});