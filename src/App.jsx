import React, { useState, useEffect, useRef } from 'react';
import { Send, AlertTriangle, Settings, BookOpen, X, Baby, Info, Users, Wifi, RefreshCw, LogIn, Heart } from 'lucide-react';
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, onSnapshot } from "firebase/firestore";

// --- ⚠️ 배포 설정 가이드 (Vercel/Netlify 배포 시 수정 필요) ---
// 1. Firebase 콘솔(console.firebase.google.com) 접속
// 2. 프로젝트 설정 > 내 앱 > SDK 설정 및 구성 선택
// 3. 아래 firebaseConfig 객체의 내용을 복사한 값으로 교체하세요.
const manualFirebaseConfig = {
  apiKey: "YOUR_API_KEY", // 예: "AIzaSy..."
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};

// --- Firebase 초기화 (자동 감지 로직 개선) ---
let app, auth, db;
let isFirebaseInitialized = false;

try {
  let config;
  
  // 1. 현재 프리뷰 환경인지 확인 (자동 설정 사용)
  if (typeof __firebase_config !== 'undefined') {
    config = JSON.parse(__firebase_config);
    isFirebaseInitialized = true;
  } 
  // 2. 배포 환경일 경우 (수동 설정 사용)
  else {
    config = manualFirebaseConfig;
    // 사용자가 키를 설정했는지 확인 (Placeholder 상태면 초기화 안 함)
    if (config.apiKey !== "YOUR_API_KEY") {
        isFirebaseInitialized = true;
    }
  }

  if (isFirebaseInitialized) {
    app = initializeApp(config);
    auth = getAuth(app);
    db = getFirestore(app);
  }

} catch (error) {
  console.error("Firebase 초기화 실패:", error);
  isFirebaseInitialized = false;
}

// 상수로 고정된 앱 ID
const APP_NAMESPACE = 'my-newborn-care';

// --- Gemini API Key ---
const GOOGLE_API_KEY = "AIzaSyBaQADcq3gdSUYh4fvhMPgUkvSkQlk7pDo"; 

const SYSTEM_PROMPT_TEMPLATE = `
# 신생아 육아 전문 AI 어시스턴트

당신은 신생아(출생~생후 4주) 육아 전문 AI 어시스턴트입니다.
조리원 간호사 10년 경력의 전문성과 따뜻한 엄마의 감성을 동시에 갖춘 조력자입니다.

## 핵심 역할 및 원칙
- **전문성**: 신생아 간호, 모유 수유, 신생아 질환 조기 발견의 전문가
- **소통 방식**: 불안한 초보 부모를 안심시키되, 의학적 정확성을 절대 타협하지 않음
- **응답 철학**: "괜찮아요"가 아닌 "이런 이유로 정상이에요" + "이럴 땐 병원 가세요"의 명확한 구분
- **현재 시각**: {CURRENT_DATE}
- **대상 아기 정보**: 생일 {BABY_BIRTHDATE} (생후 {DAYS_OLD}일차), {FEEDING_TYPE} 중

## 지식 베이스
- 온습도: 23-25°C, 30-50% 습도
- 체온: 36.0-37.0°C 정상, 38.0°C 이상 응급
- 수유: 분유(물->분유), 모유(수유텀 강박 X)
- 배변: 흰색/회색변, 피 섞인 변, 콧물 변 위험

## 가이드라인
1. 38도, 청색증, 호흡곤란, 경련 언급 시 즉시 병원 안내
2. 약물 처방 금지
3. "홍이님" 호칭 사용, 따뜻한 어조
`;

const EMERGENCY_KEYWORDS = ['38도', '38.0', '39도', '40도', '경련', '청색증', '숨을 안', '호흡곤란', '의식', '축 늘어'];

const App = () => {
  // --- 상태 관리 ---
  const [hasEntered, setHasEntered] = useState(false);
  const [inputId, setInputId] = useState('');
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [emergencyDetected, setEmergencyDetected] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const chatEndRef = useRef(null);

  // 데이터 동기화 상태
  const [familyId, setFamilyId] = useState('');
  const [babyProfile, setBabyProfile] = useState({
    name: '아기',
    birthDate: new Date().toISOString().split('T')[0],
    feedingType: '모유 수유'
  });
  const [isSyncing, setIsSyncing] = useState(false);

  // 1. 네트워크 감지
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 2. Firebase Auth
  useEffect(() => {
    if (!isFirebaseInitialized || !auth) return;
    
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (error) {
        console.error("Auth Error:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 3. 데이터 동기화
  useEffect(() => {
    if (!isFirebaseInitialized || !user || !hasEntered || !familyId || !db) return;

    setIsSyncing(true);
    const docRef = doc(db, 'artifacts', APP_NAMESPACE, 'families', familyId);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.babyProfile) setBabyProfile(data.babyProfile);
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages);
        } else {
          setMessages([{
            role: 'model',
            text: `안녕하세요, 홍이님! ${familyId} 가족방에 오신 것을 환영해요. 🍼\n우리 아기의 상태를 기록하고 궁금한 점을 물어보세요.`
          }]);
        }
      } else {
        setMessages([{
          role: 'model',
          text: `반가워요! '${familyId}' 가족방이 새로 생성되었습니다. 🎉\n아기 생일만 설정하면 바로 시작할 수 있어요.`
        }]);
      }
      setIsSyncing(false);
    }, (error) => {
      console.error("Sync Error:", error);
      setIsSyncing(false);
    });

    return () => unsubscribe();
  }, [user, hasEntered, familyId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // --- 핸들러 ---

  const handleLogin = (e) => {
    e.preventDefault();
    if (!inputId.trim()) return;
    setFamilyId(inputId.trim());
    setHasEntered(true);
  };

  const saveDataToCloud = async (newMessages, newProfile) => {
    if (!isFirebaseInitialized || !user || !familyId || !db) return;
    try {
      const docRef = doc(db, 'artifacts', APP_NAMESPACE, 'families', familyId);
      await setDoc(docRef, {
        babyProfile: newProfile || babyProfile,
        messages: newMessages || messages,
        lastUpdated: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      console.error("Save Error:", error);
    }
  };

  const calculateDaysOld = (birthDateString) => {
    const birth = new Date(birthDateString);
    const today = new Date();
    const diffTime = Math.abs(today - birth);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const callGemini = async (userMessage) => {
    setIsLoading(true);
    const daysOld = calculateDaysOld(babyProfile.birthDate);
    const finalSystemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace('{CURRENT_DATE}', new Date().toLocaleDateString())
      .replace('{BABY_BIRTHDATE}', babyProfile.birthDate)
      .replace('{DAYS_OLD}', daysOld)
      .replace('{FEEDING_TYPE}', babyProfile.feedingType);

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: finalSystemPrompt }] },
            ...messages.filter(m => m.role !== 'system').map(m => ({
              role: m.role,
              parts: [{ text: m.text }]
            })),
            { role: "user", parts: [{ text: userMessage }] }
          ],
          generationConfig: { temperature: 0.7, maxOutputTokens: 4000 }
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      
      const aiResponse = data.candidates[0].content.parts[0].text;
      const updatedMessages = [...messages, { role: 'user', text: userMessage }, { role: 'model', text: aiResponse }];
      
      setMessages(updatedMessages);
      saveDataToCloud(updatedMessages, null);

    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', text: `⚠️ 오류: ${error.message}`, isError: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;
    
    if (EMERGENCY_KEYWORDS.some(k => input.includes(k))) setEmergencyDetected(true);
    else setEmergencyDetected(false);

    const updatedMessages = [...messages, { role: 'user', text: input }];
    setMessages(updatedMessages);
    callGemini(input);
    setInput('');
  };

  // --- 화면 렌더링 ---

  // 1. Firebase 설정 누락 시 안내 화면 (배포 환경용)
  if (!isFirebaseInitialized) {
    return (
       <div className="min-h-screen bg-pink-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md text-center">
           <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4"/>
           <h2 className="text-xl font-bold text-slate-800 mb-2">Firebase 설정 필요</h2>
           <p className="text-sm text-slate-600 mb-4">
             배포된 환경에서는 Firebase 설정이 필요합니다.<br/>
             <code>App.jsx</code> 파일 상단의 <code>manualFirebaseConfig</code> 부분을 실제 키 값으로 수정해주세요.
           </p>
           <div className="text-xs text-left bg-slate-100 p-3 rounded-lg overflow-x-auto border border-slate-200">
             <code className="whitespace-pre">
{`const manualFirebaseConfig = {
  apiKey: "YOUR_API_KEY",
  ...
};`}
             </code>
           </div>
           <p className="mt-4 text-xs text-slate-400">
             * 현재는 설정값이 "YOUR_API_KEY"로 되어 있어 앱이 실행되지 않습니다.
           </p>
        </div>
       </div>
    );
  }

  // 2. 로그인 화면 (Intro)
  if (!hasEntered) {
    return (
      <div className="min-h-screen bg-pink-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md text-center">
          <div className="w-20 h-20 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Baby className="w-10 h-10 text-pink-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">우리 아기 육아 매니저</h1>
          <p className="text-slate-500 mb-8">가족 ID를 입력하여 입장하세요</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="text-left">
              <label className="text-xs font-bold text-slate-500 ml-1">가족 ID</label>
              <input
                type="text"
                value={inputId}
                onChange={(e) => setInputId(e.target.value)}
                placeholder="예: love_baby_2024"
                className="w-full mt-1 p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-pink-500 outline-none text-lg"
              />
              <p className="text-xs text-slate-400 mt-2 ml-1">
                * 아내/남편분과 동일한 ID를 입력하면 대화 내용이 공유됩니다.
              </p>
            </div>
            <button
              type="submit"
              disabled={!inputId.trim()}
              className="w-full py-4 bg-pink-500 text-white rounded-2xl font-bold text-lg shadow-lg hover:bg-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              입장하기 <LogIn className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 3. 메인 화면
  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      {/* 사이드바 */}
      <div className={`fixed inset-y-0 left-0 transform ${showKnowledge ? "translate-x-0" : "-translate-x-full"} md:relative md:translate-x-0 transition duration-200 z-30 w-80 bg-white border-r border-slate-200 flex flex-col shadow-lg md:shadow-none`}>
        <div className="p-5 border-b border-slate-100 bg-pink-50 flex justify-between">
          <h1 className="font-bold text-xl text-pink-600 flex items-center gap-2"><Baby /> 신생아 케어</h1>
          <button onClick={() => setShowKnowledge(false)} className="md:hidden"><X /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <KnowledgeCard title="🌡️ 발열" content="38.0°C 이상 즉시 병원. 37.3°C~ 미열 관리." color="bg-red-50 border-red-100"/>
          <KnowledgeCard title="🍼 수유" content="4kg 기준 80-90cc. 2-3시간 간격." color="bg-blue-50 border-blue-100"/>
          <KnowledgeCard title="💩 배변" content="회색/흰색/붉은변 위험. 잘 먹고 잘 놀면 녹변도 OK." color="bg-yellow-50 border-yellow-100"/>
        </div>
        <div className="p-4 border-t text-xs text-slate-500">
          <div className="flex items-center gap-2 mb-2">
            {isSyncing ? <RefreshCw className="w-3 h-3 animate-spin"/> : <span className={`w-2 h-2 rounded-full ${isOnline?'bg-green-500':'bg-red-500'}`}/>}
            {isSyncing ? '동기화 중...' : (isOnline ? '온라인' : '오프라인')}
          </div>
          <p>⚠️ 의학적 진단 대체 불가</p>
        </div>
      </div>

      {/* 채팅 영역 */}
      <div className="flex-1 flex flex-col h-full relative">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 shadow-sm z-20">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowKnowledge(true)} className="md:hidden p-2 bg-slate-100 rounded-full"><BookOpen className="w-5 h-5"/></button>
            <div>
              <span className="font-bold flex items-center gap-2">
                홍이님 (D+{calculateDaysOld(babyProfile.birthDate)})
                <span className="text-[10px] px-2 bg-slate-100 rounded-full text-slate-500">ID: {familyId}</span>
              </span>
            </div>
          </div>
          <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-slate-100 rounded-full"><Settings className="w-6 h-6"/></button>
        </header>

        {emergencyDetected && (
          <div className="bg-red-500 text-white p-3 flex gap-3 shadow-md animate-pulse z-10">
            <AlertTriangle className="w-6 h-6 flex-shrink-0" />
            <div><p className="font-bold">응급 상황 감지!</p><p className="text-sm">즉시 119나 응급실로 이동하세요.</p></div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl p-4 shadow-sm ${msg.role === 'user' ? 'bg-pink-500 text-white rounded-tr-none' : 'bg-white border border-slate-100 rounded-tl-none'}`}>
                <div className="whitespace-pre-wrap text-sm md:text-base">{msg.role === 'model' && idx === 0 && <span className="text-2xl mr-2">👩‍⚕️</span>}{msg.text}</div>
              </div>
            </div>
          ))}
          {isLoading && <div className="bg-white p-4 rounded-2xl w-fit shadow-sm"><div className="flex gap-1"><div className="w-2 h-2 bg-pink-400 rounded-full animate-bounce"/><div className="w-2 h-2 bg-pink-400 rounded-full animate-bounce delay-100"/><div className="w-2 h-2 bg-pink-400 rounded-full animate-bounce delay-200"/></div></div>}
          <div ref={chatEndRef} />
        </div>

        <div className="p-4 bg-white border-t">
           <div className="flex gap-2 mb-3 overflow-x-auto pb-1 scrollbar-hide">
            {['체온 37.5도', '딸꾹질 멈추는 법', '수유텀'].map((q, i) => (
              <button key={i} onClick={() => setInput(q)} className="flex-shrink-0 px-3 py-1 bg-pink-50 text-pink-600 text-xs rounded-full border border-pink-100">{q}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e)=>e.key==='Enter'&&!e.nativeEvent.isComposing&&handleSend()} placeholder="질문 입력..." className="flex-1 px-4 py-3 bg-slate-100 rounded-full focus:outline-none focus:ring-2 focus:ring-pink-300"/>
            <button onClick={handleSend} disabled={isLoading||!input.trim()} className="p-3 bg-pink-500 text-white rounded-full disabled:bg-slate-200"><Send className="w-5 h-5"/></button>
          </div>
        </div>
      </div>

      {/* 설정 모달 */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
            <div className="flex justify-between mb-6"><h2 className="text-xl font-bold">설정</h2><button onClick={()=>setShowSettings(false)}><X/></button></div>
            <div className="space-y-4">
              <div className="bg-pink-50 p-3 rounded-xl border border-pink-100 text-center">
                <span className="text-xs text-pink-600 font-bold block mb-1">현재 가족 ID</span>
                <span className="text-lg font-bold text-pink-800">{familyId}</span>
              </div>
              <div>
                <label className="text-sm font-bold block mb-1">아기 생일</label>
                <input type="date" value={babyProfile.birthDate} onChange={(e)=>setBabyProfile({...babyProfile, birthDate: e.target.value})} className="w-full p-2 border rounded-lg"/>
              </div>
              <div>
                <label className="text-sm font-bold block mb-1">수유 방식</label>
                <select value={babyProfile.feedingType} onChange={(e) => setBabyProfile({...babyProfile, feedingType: e.target.value})} className="w-full p-2 border rounded-lg">
                  <option>모유 수유</option>
                  <option>분유 수유</option>
                  <option>혼합 수유</option>
                </select>
              </div>
            </div>
            <button onClick={()=>{saveDataToCloud(messages, babyProfile); setShowSettings(false);}} className="w-full mt-6 bg-slate-900 text-white py-3 rounded-xl">저장하기</button>
          </div>
        </div>
      )}
    </div>
  );
};

const KnowledgeCard = ({ title, content, color }) => (
  <div className={`p-3 rounded-xl border ${color}`}><h3 className="font-bold text-sm mb-1">{title}</h3><p className="text-xs text-slate-600">{content}</p></div>
);

export default App;