// ============================================================
// common-core.js — 출고/입고 공통 코어 (google 폴리필)
// 두 페이지 100% 동일. renderCalendar 등 페이지 함수보다 먼저 로드.
// ============================================================

// 🚀 구글 의존성 100% 삭제 + [모바일 스텔스 방어막 V2 탑재!]
      const VERCEL_API_URL = "/api/calendar";

      const google = {
          script: {
              get run() { 
                  return {
                      _ok: null, _err: null,
                      withSuccessHandler: function(cb) { this._ok = cb; return this; },
                      withFailureHandler: function(cb) { this._err = cb; return this; },
                      
                      // 🛡️ [핵심] 조용히 넘어가야 할 네트워크 에러인지 판별하는 필터
                      _isSilentError: function(e) {
                          if (!navigator.onLine) return true; // 폰 자체가 오프라인일 때
                          const msg = (e.message || e.name || "").toLowerCase();
                          return msg.includes('abort') || msg.includes('failed to fetch') || msg.includes('load failed') || msg.includes('networkerror');
                      },

                      _call: function(payload) {
                          setLoadingState(true);
                          const controller = new AbortController();
                          const timeoutId = setTimeout(() => controller.abort(), 15000);

                          fetch(VERCEL_API_URL, { method: 'POST', body: JSON.stringify(payload), signal: controller.signal })
                              // ... (fetch 응답 처리 부분) ...
.then(r => r.json()).then(d => { 
    clearTimeout(timeoutId);
    let finalData = typeof d === 'string' ? JSON.parse(d) : d; 
    
    // 🚨 [6번 요구사항] 강제 로그아웃 명령 수신 시 즉시 폭파!
    if (finalData && finalData.forceLogout) {
        alert(finalData.msg || "🚨 계정이 비활성화되어 로그아웃됩니다.");
        executeLogout();
        return;
    }

    if (finalData && finalData.error) {
        alert("🔥 서버 에러: " + finalData.error);
        setLoadingState(false); return;
    }
    if(this._ok) this._ok(finalData); 
}).catch(e => { 
                                  clearTimeout(timeoutId);
                                  // 🚨 네트워크 기절 상태면 팝업 띄우지 않고 조용히 종료!
                                  if (this._isSilentError(e)) { console.warn("스텔스 차단 (POST):", e.message); return; }
                                  
                                  alert("🔥 통신 에러: " + e.message);
                                  if(this._err) this._err(e); 
                              }).finally(() => setLoadingState(false));
                      },
                      getCalendarDataAsync: function(type, y, m) {
                          setLoadingState(true);
                          fetch(`${VERCEL_API_URL}?api=true&type=${type}&year=${y}&month=${m}&t=${Date.now()}`)
                              .then(r => r.json()).then(d => { 
                                  if (d && d.error) {
                                      alert("🔥 달력 로딩 에러: " + d.error);
                                      setLoadingState(false); return;
                                  }
                                  if(this._ok) this._ok(d); 
                              }).catch(e => { 
                                  // 🚨 화면 전환 시 발생하는 찌꺼기 에러 완벽 차단!
                                  if (this._isSilentError(e)) { console.warn("스텔스 차단 (달력로딩):", e.message); return; }
                                  
                                  alert("🔥 달력 통신 에러: " + e.message);
                                  if(this._err) this._err(e); 
                              }).finally(() => setLoadingState(false));
                      },
                      getYearlyStatsAsync: function(type, y) { 
                          setLoadingState(true);
                          fetch(`${VERCEL_API_URL}?api=true&action=yearlyStats&type=${type}&year=${y}&t=${Date.now()}`)
                              .then(r => r.json()).then(d => { 
                                  if (d && d.error) { alert("🔥 통계 에러: " + d.error); return; }
                                  if(this._ok) this._ok(d); 
                              }).catch(e => { 
                                  // 🚨 차단!
                                  if (this._isSilentError(e)) return;
                                  if(this._err) this._err(e); 
                              }).finally(() => setLoadingState(false));
                      },
                      manageWebOutboundData: function(act, data, tk) { 
    this._call({ source: 'vercel', domain: 'out', action: act, data: data, token: tk, admin_id: localStorage.getItem('admin_id') }); 
},
manageWebInboundData: function(act, data, tk) { 
    this._call({ source: 'vercel', domain: 'in', action: act, data: data, token: tk, admin_id: localStorage.getItem('admin_id') }); 
},
                      verifyAdminPw: function(pw) {
                          setLoadingState(true);
                          fetch(VERCEL_API_URL, { method: 'POST', body: JSON.stringify({ source: 'vercel', domain: currentType, action: 'PING', data: {}, token: pw }) })
                              .then(r => r.json()).then(d => { if(this._ok) this._ok(!(d.msg && d.msg.includes('보안'))); }).catch(e => { 
                                  if (this._isSilentError(e)) return;
                                  if(this._err) this._err(e); 
                              }).finally(() => setLoadingState(false));
                      },
                      login: function(id, pw) { 
                          this._call({ source: 'vercel', action: 'LOGIN', data: { id: id, pw: pw } }); 
                      },
                      getGlobalColors: function() { this._call({ source: 'vercel', action: 'GET_GLOBAL_COLORS' }); },
                      saveGlobalColor: function(c, i) { this._call({ source: 'vercel', action: 'SAVE_GLOBAL_COLOR', compName: c, colorIdx: i }); },
                      getLastOcrImageUrl: function() { this._call({ source: 'vercel', domain: 'system', action: 'GET_LAST_OCR_IMAGE' }); },
                      getLastOcrData: function() { this._call({ source: 'vercel', domain: 'system', action: 'GET_LAST_OCR_DATA' }); },
                      getOcrLastTimeStr: function() { this._call({ source: 'vercel', domain: 'system', action: 'GET_OCR_LAST_TIME' }); },
                      getYearlyHolidays: function(y) { this._call({ source: 'vercel', action: 'GET_YEARLY_HOLIDAYS', year: y }); },
                      getCompInfoDB: function() { this._call({ source: 'vercel', action: 'GET_COMP_INFO_DB' }); },
                      saveCompInfoDB: function(dbData) { this._call({ source: 'vercel', action: 'SAVE_COMP_INFO_DB', data: dbData }); }
                  };
              }
          }
      };
