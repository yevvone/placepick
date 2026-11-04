// DOM이 로드된 후 실행
document.addEventListener('DOMContentLoaded', async function() {
    // DOM 요소
    const imageInput = document.getElementById('imageInput');
    const urlInput = document.getElementById('urlInput');
    const imageUploadSection = document.getElementById('imageUploadSection');
    const urlInputSection = document.getElementById('urlInputSection');
    const imageFile = document.getElementById('imageFile');
    const urlInputField = document.getElementById('urlInputField');
    const processButton = document.getElementById('processButton');
    const imagePreview = document.getElementById('imagePreview');
    const loading = document.querySelector('.loading');
    const resultContainer = document.querySelector('.result-container');
    const locationList = document.getElementById('locationList');
    window.resultContainer = resultContainer;

    // 입력 방식 전환
    if (imageInput && urlInput) {
        imageInput.addEventListener('change', () => {
            imageUploadSection.style.display = 'block';
            urlInputSection.style.display = 'none';
        });

        urlInput.addEventListener('change', () => {
            imageUploadSection.style.display = 'none';
            urlInputSection.style.display = 'block';
        });
    }

    // 이미지 미리보기
    if (imageFile) {
        imageFile.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                handleImageFile(file);
            }
        });
    }
    
    // 재추출 버튼 초기 상태 설정
    updateReextractButtonState();
    
    // 드래그앤드롭 기능 초기화
    initDragAndDrop();
    
    // 클립보드 붙여넣기 기능 초기화
    initClipboardPaste();

    // 재추출 버튼 클릭 이벤트
    if (processButton) {
        processButton.addEventListener('click', async () => {
            // 현재 이미지가 있는지 확인
            if (imagePreview.src && imagePreview.src !== 'data:') {
                console.log('재추출 시작: 이미지 재처리...');
                await processImage();
            } else if (urlInputField && urlInputField.value.trim()) {
                console.log('재추출 시작: URL 재처리...');
                await processUrl();
            } else {
                alert('재추출할 이미지나 URL이 없습니다.\n먼저 이미지를 업로드하거나 URL을 입력해주세요.');
            }
        });
    }

    // 지도 초기화 - API 로딩 완료 후 실행
    function waitForNaverAPI() {
        return new Promise((resolve) => {
            if (typeof naver !== 'undefined' && naver.maps) {
                console.log('✅ 네이버 지도 API 이미 로드됨');
                resolve();
                return;
            }
            
            console.log('⏳ 네이버 지도 API 로드 대기 중...');
            const checkAPI = setInterval(() => {
                if (typeof naver !== 'undefined' && naver.maps) {
                    console.log('✅ 네이버 지도 API 로드 완료');
                    clearInterval(checkAPI);
                    resolve();
                }
            }, 100);
        });
    }
    
    // API 로드 완료 후 지도 초기화
    waitForNaverAPI().then(() => {
        initMap();
    }).catch(error => {
        console.error('❌ 네이버 지도 API 로드 실패:', error);
    });
    
    // 나의 장소 초기화
    myPlaceListEl = document.getElementById('myPlaceList');
    myListSortByEl = document.getElementById('myListSortBy');
    
    // 정렬 컨트롤 이벤트 리스너 추가
    if (myListSortByEl) {
        myListSortByEl.addEventListener('change', renderMyPlaces);
    }
    
    // 로그인 사용자 확인 → 마이그레이션 → 목록 초기 로드
    CURRENT_USER = await fetchCurrentUser();
    if (CURRENT_USER) {
        // 사용자 닉네임 표시
        const userNicknameEl = document.getElementById('userNickname');
        if (userNicknameEl) {
            if (CURRENT_USER.nickname && CURRENT_USER.nickname.trim()) {
                userNicknameEl.textContent = CURRENT_USER.nickname;
                console.log('✅ 닉네임 표시 성공:', CURRENT_USER.nickname);
            } else {
                userNicknameEl.textContent = '닉네임 없음';
                console.log('⚠️ 닉네임이 비어있음');
            }
        }
        
        await migrateLocalToServerIfNeeded();
        await refreshMyPlacesFromServer();
    } else {
        myPlaces = loadMyPlaces();
        renderMyPlaces();
    }
    
    // 로그아웃 버튼 이벤트 리스너 추가
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/auth/logout', { method: 'POST' });
                if (response.ok) {
                    // 로그아웃 성공 시 로그인 페이지로 리다이렉트
                    window.location.href = '/';
                }
            } catch (error) {
                console.error('로그아웃 실패:', error);
                // 에러가 발생해도 로그인 페이지로 이동
                window.location.href = '/';
            }
        });
    }
});

// 이미지 파일 처리 함수
function handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
        alert('이미지 파일만 업로드 가능합니다.');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        imagePreview.src = e.target.result;
        imagePreview.style.display = 'block';
        
        // 파일 선택 상태 업데이트
        updateFileSelectionStatus(file.name);
        
        // 이미지 업로드 시 자동으로 OCR 처리 시작
        console.log('이미지 업로드 완료, 자동 OCR 처리 시작...');
        await processImage();
    };
    reader.readAsDataURL(file);
}

// 파일 선택 상태 업데이트
function updateFileSelectionStatus(fileName) {
    const statusElement = document.querySelector('#imageUploadSection .text-muted.small');
    if (statusElement) {
        statusElement.textContent = fileName || '선택된 파일 없음';
    }
    
    // 재추출 버튼 상태 업데이트
    updateReextractButtonState();
}

// 재추출 버튼 상태 업데이트
function updateReextractButtonState() {
    const processButton = document.getElementById('processButton');
    if (!processButton) return;
    
    const hasImage = imagePreview && imagePreview.src && imagePreview.src !== 'data:';
    const hasUrl = urlInputField && urlInputField.value.trim();
    
    if (hasImage || hasUrl) {
        processButton.disabled = false;
        processButton.classList.remove('btn-secondary');
        processButton.classList.add('btn-warning');
    } else {
        processButton.disabled = true;
        processButton.classList.remove('btn-warning');
        processButton.classList.add('btn-secondary');
    }
}

// 드래그앤드롭 기능 초기화
function initDragAndDrop() {
    const dragDropArea = document.getElementById('dragDropArea');
    if (!dragDropArea) return;
    
    // 드래그 이벤트
    dragDropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dragDropArea.classList.add('dragover');
    });
    
    dragDropArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragDropArea.classList.remove('dragover');
    });
    
    dragDropArea.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragDropArea.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        const items = e.dataTransfer.items;
        
        if (files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('image/')) {
                // 파일 입력 필드에 파일 설정
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                imageFile.files = dataTransfer.files;
                
                // 이미지 처리 및 자동 OCR 시작
                handleImageFile(file);
            } else {
                alert('이미지 파일만 드롭 가능합니다.');
            }
        } else if (items.length > 0) {
            // 링크 드롭 감지
            for (let item of items) {
                if (item.type === 'text/plain') {
                    item.getAsString(async (text) => {
                        if (isValidUrl(text)) {
                            console.log('드롭된 URL 감지:', text);
                            
                            // 자동 처리 설정 확인
                            const autoProcessToggle = document.getElementById('autoProcessToggle');
                            if (autoProcessToggle && autoProcessToggle.checked) {
                                // Instagram 링크는 즉시 자동 처리
                                if (text.includes('instagram.com')) {
                                    console.log('Instagram 링크 자동 처리 시작...');
                                    await autoProcessUrl(text);
                                } else {
                                    // 일반 링크는 사용자에게 확인
                                    if (confirm(`링크를 자동으로 처리하시겠습니까?\n\n${text}`)) {
                                        await autoProcessUrl(text);
                                    }
                                }
                            }
                            
                            // URL 입력 필드에 자동 입력
                            if (urlInputField) {
                                urlInputField.value = text;
                                // URL 입력 섹션으로 자동 전환
                                if (urlInput) {
                                    urlInput.checked = true;
                                    urlInputSection.style.display = 'block';
                                    imageUploadSection.style.display = 'none';
                                }
                            }
                        }
                    });
                    break;
                }
            }
        }
    });
    
    // 클릭으로도 파일 선택 가능
    dragDropArea.addEventListener('click', () => {
        imageFile.click();
    });
}

// 클립보드 붙여넣기 기능 초기화
function initClipboardPaste() {
    document.addEventListener('paste', async (e) => {
        const items = e.clipboardData.items;
        let processed = false;
        
        for (let item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    // 파일 입력 필드에 파일 설정
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);
                    imageFile.files = dataTransfer.files;
                    
                    // 이미지 처리 및 자동 OCR 시작
                    handleImageFile(file);
                    processed = true;
                    break;
                }
            } else if (item.type === 'text/plain') {
                // 텍스트 클립보드 감지
                item.getAsString(async (text) => {
                    if (isValidUrl(text)) {
                        console.log('클립보드에서 URL 감지:', text);
                        
                        // 자동 처리 설정 확인
                        const autoProcessToggle = document.getElementById('autoProcessToggle');
                        if (autoProcessToggle && autoProcessToggle.checked) {
                            // Instagram 링크는 즉시 자동 처리
                            if (text.includes('instagram.com')) {
                                console.log('Instagram 링크 자동 처리 시작...');
                                await autoProcessUrl(text);
                            } else {
                                // 일반 링크는 사용자에게 확인
                                if (confirm(`링크를 자동으로 처리하시겠습니까?\n\n${text}`)) {
                                    await autoProcessUrl(text);
                                }
                            }
                        }
                        
                        // URL 입력 필드에 자동 입력
                        if (urlInputField) {
                            urlInputField.value = text;
                            // URL 입력 섹션으로 자동 전환
                            if (urlInput) {
                                urlInput.checked = true;
                                urlInputSection.style.display = 'block';
                                imageUploadSection.style.display = 'none';
                            }
                        }
                    }
                });
                processed = true;
            }
        }
        
        if (processed) {
            e.preventDefault();
        }
    });
}

// URL 유효성 검사 함수
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// 자동 URL 처리 함수
async function autoProcessUrl(url) {
    try {
        console.log('자동 URL 처리 시작:', url);
        showLoading();
        
        // URL에서 텍스트 추출
        const response = await fetch('http://localhost:3000/extract', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url })
        });
        
        if (!response.ok) {
            throw new Error('URL 처리 중 오류가 발생했습니다.');
        }
        
        const data = await response.json();
        const text = data.data && data.data.text ? data.data.text : '';
        const hashtags = data.data && data.data.hashtags ? data.data.hashtags : '';
        
        // 장소명 후보 추출 및 지도에 마커 표시
        const places = extractPlaceCandidates(text);
        if (places.length > 0) {
            // 마커 표시가 완료된 후에 로딩 숨기기
            await markPlacesFromExtracted(places);
        }
        
        await findBestPlaceFromText(text, hashtags);
        hideLoading();
        
        // 성공 메시지
        showSuccessMessage(`링크가 자동으로 처리되었습니다! ${places.length}개의 장소를 발견했습니다.`);
        
    } catch (error) {
        console.error('자동 URL 처리 중 오류:', error);
        hideLoading();
        showError('자동 처리 중 오류가 발생했습니다: ' + error.message);
    }
}

// 🔽 extractPlaceCandidates 위쪽이나 아래쪽, 아무데나 배치해도 됨
function extractNameAddressPairs(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    const nameLine = lines[i];

    // (1) 가게명 후보: '위치/주소' 같은 단어가 없고, 한글/영문/숫자/점/중점 정도만, 너무 길지 않게
    const isName =
      !/(위치|주소|apt[_\s-]*lap|팔로워|instagram|@|#)/i.test(nameLine) &&
      /^[가-힣A-Za-z0-9·.\s]{2,25}$/.test(nameLine);

    if (!isName) continue;

    // (2) 다음 1~4줄 안에서 '위치:' 또는 '주소:' 라인 찾기
    for (let j = 1; j <= 4 && i + j < lines.length; j++) {
      const addrLine = lines[i + j];
      const m =
        addrLine.match(/(?:위치|주소)\s*[:：]?\s*(.+)$/) ||
        addrLine.match(/([가-힣A-Za-z0-9\-]+(구|군|시)\s+[가-힣A-Za-z0-9\-]+(로|길|대로)\s*\d+.*)$/);

      if (m) {
        const name = nameLine.replace(/\s{2,}/g, ' ').trim();
        const address = m[1].replace(/\s{2,}/g, ' ').trim();
        // 너무 짧은 주소/의미없는 조각은 제외
        if (address.length >= 5) {
          pairs.push({ name, address });
        }
        break;
      }
    }
  }

  // 중복 제거
  const seen = new Set();
  return pairs.filter(p => {
    const key = `${p.name}|${p.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


// 장소명 후보 추출 함수 (개선된 버전)
function extractPlaceCandidates(text) {
    console.log('장소 추출 대상 텍스트:', text);
    
    const candidates = [];
    const scores = new Map(); // 각 후보에 점수 부여
    
    // 1. 핵심 장소명 패턴 (가장 높은 우선순위)
    const corePlacePattern = /([가-힣A-Za-z0-9\s]+(?:역|대학교|대|시청|공원|타워|센터|관|병원|교|마을|시장|공항|터미널|호텔|빌딩|플라자|몰|스퀘어|하우스|맨션|문화사|베이커리|카페|식당|맛집))/g;
    let coreMatch;
    while ((coreMatch = corePlacePattern.exec(text)) !== null) {
        const placeName = coreMatch[1].trim();
        if (placeName.length > 2 && placeName.length < 30) {
            candidates.push(placeName);
            scores.set(placeName, 100); // 최고 점수
            console.log('핵심 장소명 발견 (점수: 100):', placeName);
        }
    }
    
    // 2. 명시적 위치 표시 패턴 (높은 우선순위)
    const explicitLocationPattern = /(?:위치|주소|address|매장|상호|업체|가게)\s*[:：]\s*([가-힣A-Za-z0-9\s\-]+)/g;
    let explicitMatch;
    while ((explicitMatch = explicitLocationPattern.exec(text)) !== null) {
        const location = explicitMatch[1].trim();
        if (location.length > 3 && location.length < 50) {
            candidates.push(location);
            scores.set(location, 90); // 높은 점수
            console.log('명시적 위치 발견 (점수: 90):', location);
        }
    }
    
    // 3. 완전한 주소 패턴 (중간 우선순위)
    const fullAddressPattern = /([가-힣]+(시|도|특별시|광역시)\s+)?[가-힣]+(구|군|시)\s+[가-힣A-Za-z0-9\s\-]+(로|길|대로)\s+\d+[\-\d\s]*(?:[가-힣]|\d)*\s*(?:\d*층)?\s*(?:\d*호)?/g;
    const fullAddresses = text.match(fullAddressPattern) || [];
    fullAddresses.forEach(addr => {
        const cleanAddr = addr.trim();
        if (cleanAddr.length > 5 && cleanAddr.length < 100) {
            candidates.push(cleanAddr);
            scores.set(cleanAddr, 80); // 중간 점수
            console.log('완전한 주소 발견 (점수: 80):', cleanAddr);
        }
    });
    
    // 4. 해시태그에서 장소명 추출 (낮은 우선순위)
    const hashtagPattern = /#([가-힣A-Za-z0-9]+)/g;
    let hashMatch;
    while ((hashMatch = hashtagPattern.exec(text)) !== null) {
        const hashtag = hashMatch[1];
        if (hashtag.length > 2 && hashtag.length < 20) {
            candidates.push(hashtag);
            scores.set(hashtag, 60); // 낮은 점수
            console.log('해시태그 장소 발견 (점수: 60):', hashtag);
        }
    }
    
    // 5. 단순 주소 패턴 (가장 낮은 우선순위)
    const simpleAddressPattern = /[가-힣]+(구|군)\s+[가-힣A-Za-z0-9\-]+(동|로|길)\s*\d*/g;
    const simpleAddresses = text.match(simpleAddressPattern) || [];
    simpleAddresses.forEach(addr => {
        const cleanAddr = addr.trim();
        if (cleanAddr.length > 3 && cleanAddr.length < 30) {
            candidates.push(cleanAddr);
            scores.set(cleanAddr, 40); // 가장 낮은 점수
            console.log('단순 주소 발견 (점수: 40):', cleanAddr);
        }
    });
    
    // 중복 제거 및 점수 기반 필터링
    const uniqueCandidates = [];
    const seen = new Set();
    
    candidates.forEach(candidate => {
        const cleanCandidate = candidate.replace(/\s+/g, ' ').trim();
        if (!seen.has(cleanCandidate) && cleanCandidate.length > 1) {
            seen.add(cleanCandidate);
            uniqueCandidates.push({
                text: cleanCandidate,
                score: scores.get(candidate) || 0
            });
        }
    });
    
    // 점수 기반 정렬 (높은 점수 우선)
    uniqueCandidates.sort((a, b) => b.score - a.score);
    
    // 상위 점수 후보만 선택 (점수 70 이상)
    const highScoreCandidates = uniqueCandidates
        .filter(candidate => candidate.score >= 70)
        .map(candidate => candidate.text);
    
    console.log('점수별 장소 후보들:', uniqueCandidates);
    console.log('최종 선택된 장소들 (점수 70+):', highScoreCandidates);
    
    return highScoreCandidates;
}

// 이미지 처리
async function processImage() {
    const file = imageFile.files[0];
    if (!file) {
        alert('이미지 파일을 선택해주세요.');
        return;
    }

    try {
        showLoading();
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                console.log('=== 이미지 처리 시작 ===');
                // OCR로 텍스트 추출
                const extractedText = await ocrSpaceImage(e.target.result);
                const pairs = extractNameAddressPairs(extractedText);
                if (pairs.length) {
                    await searchPairsAndRender(pairs);  // 🔽 아래 함수 추가
                    hideLoading();
                    return; // 짝 추출이 됐으면 여기서 끝
                }
                console.log('OCR 추출 결과:', extractedText);
                
                if (!extractedText) {
                    throw new Error('이미지에서 텍스트를 추출할 수 없습니다.');
                }

                // 장소명 후보 추출 및 지도에 마커 표시
                const places = extractPlaceCandidates(extractedText);
                console.log('추출된 장소명 후보:', places);
                console.log('추출된 장소명 후보 (상세):', JSON.stringify(places, null, 2));
                
                if (places.length > 0) {
                    console.log('지도에 마커 표시 시작...');
                    await markPlacesFromExtracted(places);
                } else {
                    console.log('추출된 장소명이 없습니다.');
                }
                hideLoading();

                // 이미지에는 해시태그가 많지 않지만, 본문만으로도 랭킹 시도
                findBestPlaceFromText(extractedText, '');

            } catch (error) {
                console.error('이미지 처리 중 오류:', error);
                showError(error.message);
            }
        };
        reader.readAsDataURL(file);
    } catch (error) {
        console.error('이미지 처리 오류:', error);
        showError(error.message);
    }
}

// URL 처리
async function processUrl() {
    const url = urlInputField.value.trim();
    if (!url) {
        alert('URL을 입력해주세요.');
        return;
    }

    try {
        showLoading();
        console.log('=== URL 처리 시작 ===');
        console.log('요청 URL:', url);
        
        // URL에서 텍스트 추출 (서버에서 처리)
        const response = await fetch('http://localhost:3000/extract', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url })
        });

        console.log('서버 응답 상태:', response.status);
        
        if (!response.ok) {
            throw new Error('URL 처리 중 오류가 발생했습니다.');
        }

        const data = await response.json();
        console.log('서버 응답 데이터:', data);
        
        const text = data.data && data.data.text ? data.data.text : '';
        const hashtags = data.data && data.data.hashtags ? data.data.hashtags : ''; // 추가
        
        console.log('추출된 텍스트:', text);
        
        // 장소명 후보 추출 및 지도에 마커 표시
        const places = extractPlaceCandidates(text);
        console.log('추출된 장소명 후보:', places);
        
        if (places.length > 0) {
            console.log('지도에 마커 표시 시작...');
            await markPlacesFromExtracted(places);
        } else {
            console.log('추출된 장소명이 없습니다.');
        }
        await findBestPlaceFromText(text, hashtags); // 추가
        hideLoading();
    } catch (error) {
        console.error('URL 처리 중 오류:', error);
        showError(error.message);
    }
}

// 네이버 지도 초기화
let map;
let markers = [];
let infoWindows = [];

function initMap() {
    try {
        // 기본 위치 (서울시청)
        const defaultLocation = new naver.maps.LatLng(37.5666805, 126.9784147);
        
        // 지도 옵션
        const mapOptions = {
            center: defaultLocation,
            zoom: 15,
            zoomControl: true,
            zoomControlOptions: {
                position: naver.maps.Position.TOP_RIGHT
            }
        };

        // 지도 생성
        window.map = new naver.maps.Map('map', mapOptions);
        
        // 마커 배열 초기화
        window.markers = [];
        window.infoWindows = [];

        // 지도 로드 완료 이벤트
        naver.maps.Event.once(window.map, 'init', function() {
            console.log('지도 초기화 완료');
            window.map.refresh();
        });

        // 지도 크기 조정 이벤트
        window.addEventListener('resize', function() {
            if (window.map) {
                window.map.refresh();
            }
        });

    } catch (error) {
        console.error('지도 초기화 중 오류 발생:', error);
    }
}

// 마커 생성 함수
function createMarker(location) {
    if (!location.coordinates) return null;

    const position = new naver.maps.LatLng(location.coordinates.lat, location.coordinates.lng);
    
    // 마커 생성
    const marker = new naver.maps.Marker({
        position: position,
        map: window.map,
        title: location.name
    });

    // 정보창 내용 생성
    const contentString = [
        '<div class="iw_inner">',
        `   <h3>${location.name}</h3>`,
        `   <p>${location.type || '기타'}<br />`,
        location.coordinates.address ? 
            `       ${location.coordinates.address}<br />` : '',
        '   </p>',
        '</div>'
    ].join('');

    // 정보창 생성
    const infoWindow = new naver.maps.InfoWindow({
        content: contentString,
        maxWidth: 300,
        backgroundColor: "#fff",
        borderColor: "#b39ddb",
        borderWidth: 2,
        anchorSize: new naver.maps.Size(10, 10),
        anchorSkew: true,
        anchorColor: "#fff",
        pixelOffset: new naver.maps.Point(10, -10)
        });

    // 마커 클릭 이벤트
    naver.maps.Event.addListener(marker, 'click', () => {
        // 다른 정보창 닫기
        window.infoWindows.forEach(iw => iw.close());
        // 현재 정보창 열기
        infoWindow.open(window.map, marker);
    });

    window.infoWindows.push(infoWindow);
    return marker;
}

// OCR/URL에서 추출된 장소명(또는 주소) 배열을 받아 지도에 마커 표시
async function markPlacesFromExtracted(placeCandidates) {
    if (!Array.isArray(placeCandidates) || placeCandidates.length === 0) {
        console.log('장소 후보가 없습니다.');
        return;
    }
    if (!window.naver?.maps) {
        console.error('네이버 지도 API 로드 실패');
        return;
    }

    const map = window.map;
    if (!map) {
        console.error('지도가 초기화되지 않았습니다.');
        return;
    }

    // 기존 마커 모두 제거
    if (window.markers && Array.isArray(window.markers)) {
        window.markers.forEach(m => m.setMap(null));
    }
    window.markers = [];

    for (const placeName of placeCandidates) {
        try {
            const response = await fetch('/search-place?query=' + encodeURIComponent(placeName));
            const data = await response.json();
            
            if (!data.items || data.items.length === 0) {
                console.log(`장소를 찾을 수 없습니다: ${placeName}`);
                continue;
            }
            
            const item = data.items[0];
            const lng = parseFloat(item.mapx) / 1e7;
            const lat = parseFloat(item.mapy) / 1e7;
            
            const marker = new naver.maps.Marker({
                position: new naver.maps.LatLng(lat, lng),
                map: map,
                title: placeName
            });
            
            window.markers.push(marker);
            
            // 첫 번째 마커는 지도 중심 이동
            if (window.markers.length === 1) {
                map.setCenter(new naver.maps.LatLng(lat, lng));
                map.setZoom(15);
            }
            
            console.log(`마커 추가됨: ${placeName} (${lat}, ${lng})`);
        } catch (error) {
            console.error(`장소 검색 실패: ${placeName}`, error);
        }
    }
    
    console.log(`총 ${window.markers.length}개의 마커가 추가되었습니다.`);
}

// 주소 전처리 함수
function preprocessText(text) {
    return text
        .replace(/\s+/g, ' ') // 여러 공백을 하나로
        .replace(/[^\w\s가-힣\-]/g, ' ') // 특수문자 제거 (하이픈은 유지)
        .trim();
}

// 주소 후처리 함수
function postprocessAddress(address) {
    return address
        .replace(/\s+/g, ' ') // 여러 공백을 하나로
        .replace(/(\d+)([가-힣])/g, '$1 $2') // 숫자와 한글 사이에 공백 추가
        .replace(/([가-힣])(\d+)/g, '$1 $2') // 한글과 숫자 사이에 공백 추가
        .trim();
}

// 주소 유효성 검사 함수
function isValidAddress(address) {
    // 최소 길이 체크
    if (address.length < 5) return false;
    
    // 필수 요소 체크 (시/도, 구/군 중 하나는 있어야 함)
    const hasCity = /(시|도)/.test(address);
    const hasDistrict = /(구|군)/.test(address);
    if (!hasCity && !hasDistrict) return false;
    
    // 숫자가 포함되어야 함
    if (!/\d+/.test(address)) return false;
    
    return true;
}

// OCR로 추출한 텍스트에서 주소 후보 추출
function extractAddressCandidates(text) {
    // 텍스트 전처리
    const preprocessedText = preprocessText(text);
    
    const patterns = [
        // 도로명 주소 패턴
        /([가-힣A-Za-z0-9]+(시|도|특별시|광역시)\s*)?[가-힣A-Za-z0-9]+(구|군|시)\s*[가-힣A-Za-z0-9\-]+(로|길|대로|거리)\s*\d+(?:[가-힣]|\s*\d*)?/g,
        
        // 지번 주소 패턴
        /([가-힣A-Za-z0-9]+(시|도|특별시|광역시)\s*)?[가-힣A-Za-z0-9]+(구|군|시)\s*[가-힣A-Za-z0-9]+(동|읍|면|가)\s*\d+[\-\d]*(?:[가-힣]|\s*\d*)?/g,
        
        // 건물명이 포함된 주소 패턴
        /([가-힣A-Za-z0-9]+(시|도|특별시|광역시)\s*)?[가-힣A-Za-z0-9]+(구|군|시)\s*[가-힣A-Za-z0-9\-]+(로|길|대로|거리)\s*\d+(?:[가-힣]|\s*\d*)?\s*[가-힣A-Za-z0-9]+(빌딩|아파트|타워|센터|몰|플라자|스퀘어|하우스|빌라|맨션)/g,
        
        // 간단한 주소 패턴 (시/구/동만 있는 경우)
        /([가-힣A-Za-z0-9]+(시|도|특별시|광역시)\s*)?[가-힣A-Za-z0-9]+(구|군|시)\s*[가-힣A-Za-z0-9]+(동|읍|면|가)\s*\d+/g
    ];
    
    // 모든 패턴에서 주소 추출
    let candidates = patterns.flatMap(pattern => preprocessedText.match(pattern) || []);
    
    // 중복 제거 및 후처리
    candidates = [...new Set(candidates)]
        .map(postprocessAddress)
        .filter(isValidAddress);
    
    // 주소 정렬 (길이가 긴 주소를 우선)
    candidates.sort((a, b) => b.length - a.length);
    
    return candidates;
}

// 기존의 extractLocations 함수 수정
async function extractLocations(text) {
    try {
        const response = await fetch('/api/extract-locations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            throw new Error('위치 정보 추출 실패');
        }

        const data = await response.json();
        
        // 기존 마커 제거
        markers.forEach(marker => marker.setMap(null));
        markers = [];
        infoWindows = [];

        if (data.locations && data.locations.length > 0) {
            // 지도 중심점을 첫 번째 위치로 설정
            if (data.locations[0].coordinates) {
                map.setCenter(new naver.maps.LatLng(
                    data.locations[0].coordinates.lat,
                    data.locations[0].coordinates.lng
                ));
                map.setZoom(15);
            }

            data.locations.forEach(location => {
                // 마커 생성
                if (location.coordinates) {
                    const marker = createMarker(location);
                    if (marker) markers.push(marker);
                }
            });
            showResults(data.locations);
        } else {
            showResults([]);
        }

        return data.locations;
    } catch (error) {
        console.error('위치 정보 추출 중 오류:', error);
        showResults([]);
        return [];
    }
}

// 결과 표시
function showResults(locations) {
    resultContainer.style.display = 'block';
    locationList.innerHTML = '';

    if (!locations || locations.length === 0) {
        locationList.innerHTML = '<li class="list-group-item">추출된 장소가 없습니다.</li>';
        return;
    }

    // 문자열 배열(장소명)일 경우
    if (typeof locations[0] === 'string') {
        locations.forEach(place => {
            const li = document.createElement('li');
            li.className = 'list-group-item location-card';
            li.innerHTML = `
                <div class="location-card-content">
                    <div class="location-header">
                        <div class="location-icon">
                            <i class="bi bi-geo-alt-fill"></i>
                        </div>
                        <div class="location-info">
                            <h5 class="location-name">${place}</h5>
                            <p class="location-address">도로명 주소 정보를 가져오는 중...</p>
                        </div>
                    </div>
                    <div class="location-actions">
                        <button class="btn btn-sm btn-success save-btn">
                            <i class="bi bi-bookmark-plus"></i> 저장
                        </button>
                        <button class="btn btn-sm btn-outline-primary map-btn" onclick="searchAndShowOnMap('${place}')">
                            <i class="bi bi-map"></i> 지도에서 보기
                        </button>
                    </div>
                </div>
            `;
            locationList.appendChild(li);
            
            // 저장 버튼 이벤트 추가
            const saveBtn = li.querySelector('.save-btn');
            saveBtn.addEventListener('click', async () => {
                // 네이버 API로 장소 정보 검색
                try {
                    const response = await fetch(`/search-place?query=${encodeURIComponent(place)}`);
                    const data = await response.json();
                    
                    if (data.items && data.items.length > 0) {
                        const item = data.items[0];
                        const lat = parseFloat(item.mapy) / 1e7;
                        const lng = parseFloat(item.mapx) / 1e7;
                        
                        const coordinates = {
                            lat: lat,
                            lng: lng,
                            address: item.roadAddress || item.address || ''
                        };
                        
                        savePlace(place, item.category || '', coordinates);
                    } else {
                        // 검색 결과가 없으면 기본 정보로 저장
                        savePlace(place);
                    }
                } catch (error) {
                    console.error('장소 검색 실패:', error);
                    // 에러가 발생해도 기본 정보로 저장
                    savePlace(place);
                }
            });
        });
        return;
    }

    // 객체 배열(기존 방식)일 경우
    locations.forEach(location => {
        const li = document.createElement('li');
        li.className = 'list-group-item location-card';
        li.innerHTML = `
            <div class="location-card-content">
                <div class="location-header">
                    <div class="location-icon">
                        <i class="bi bi-geo-alt-fill"></i>
                    </div>
                    <div class="location-info">
                        <h5 class="location-name">${location.name}</h5>
                        <p class="location-address">
                            ${location.coordinates && location.coordinates.address ? 
                                location.coordinates.address : '도로명 주소 정보를 가져오는 중...'}
                        </p>
                        ${location.type ? `<span class="location-type">${location.type}</span>` : ''}
                    </div>
                </div>
                <div class="location-actions">
                    <button class="btn btn-sm btn-success save-btn">
                        <i class="bi bi-bookmark-plus"></i> 저장
                    </button>
                    ${location.coordinates ? 
                        `<button class="btn btn-sm btn-outline-primary map-btn" onclick="showOnMap('${location.name}', ${location.coordinates.lat}, ${location.coordinates.lng})">
                            <i class="bi bi-map"></i> 지도에서 보기
                        </button>` 
                        : `<button class="btn btn-sm btn-outline-primary map-btn" onclick="searchAndShowOnMap('${location.name}')">
                            <i class="bi bi-map"></i> 지도에서 보기
                        </button>`
                    }
                </div>
            </div>
        `;
        locationList.appendChild(li);
        
        // 저장 버튼 이벤트 추가
        const saveBtn = li.querySelector('.save-btn');
        saveBtn.addEventListener('click', () => {
            savePlace(location.name, location.type, location.coordinates);
        });
    });
}

// 장소 저장 함수
function savePlace(name, type = '', coordinates = null) {
    const place = {
        name: name,
        type: type,
        coordinates: coordinates,
        createdAt: new Date().toISOString(),
        region: coordinates && coordinates.address ? inferRegion(coordinates.address) : '',
        category: inferCategory(name, type),
        address: coordinates && coordinates.address ? coordinates.address : ''
    };
    
    upsertPlace(place);
    renderMyPlaces();
    
    // 저장 성공 메시지 표시
    showSuccessMessage('장소가 나의 장소에 저장되었습니다!');
}

// 지도에서 검색하여 표시하는 함수
async function searchAndShowOnMap(placeName) {
    try {
        const response = await fetch(`/search-place?query=${encodeURIComponent(placeName)}`);
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
            const item = data.items[0];
            const lat = parseFloat(item.mapy) / 1e7;
            const lng = parseFloat(item.mapx) / 1e7;
            
            // 지도에 마커 표시
            showOnMap(placeName, lat, lng, item.address);
            
            // 해당 장소 카드의 주소 정보 업데이트
            updatePlaceAddress(placeName, item.address);
        } else {
            alert('해당 장소를 찾을 수 없습니다.');
        }
    } catch (error) {
        console.error('장소 검색 실패:', error);
        alert('장소 검색에 실패했습니다.');
    }
}

// 지도에 표시하는 함수
function showOnMap(placeName, lat, lng, address = '') {
    if (typeof naver !== 'undefined' && naver.maps && window.map) {
        // 기존 마커들 제거
        if (window.markers) {
            window.markers.forEach(marker => marker.setMap(null));
        }
        window.markers = [];
        
        // 새로운 마커 생성 (보라색 커스텀 마커)
        const marker = new naver.maps.Marker({
            position: new naver.maps.LatLng(lat, lng),
            map: window.map,
            icon: {
                content: '<div class="custom-marker"><i class="bi bi-geo-alt-fill"></i></div>',
                size: new naver.maps.Size(40, 40),
                anchor: new naver.maps.Point(20, 20)
            }
        });
        
        // 마커를 전역 배열에 추가
        window.markers.push(marker);
        
        // 지도 중심 이동
        window.map.setCenter(new naver.maps.LatLng(lat, lng));
        window.map.setZoom(15);
        
        // 정보창 표시
        const infoWindow = new naver.maps.InfoWindow({
            content: `
                <div class="info-window">
                    <h3>${placeName}</h3>
                    ${address ? `<p class="address">${address}</p>` : ''}
                </div>
            `,
            maxWidth: 200,
            backgroundColor: "#fff",
            borderColor: "#b39ddb",
            borderWidth: 2,
            anchorSize: new naver.maps.Size(20, 20),
            anchorColor: "#fff",
            pixelOffset: new naver.maps.Point(0, -20)
        });
        
        // 정보창을 전역 배열에 추가
        if (!window.infoWindows) window.infoWindows = [];
        window.infoWindows.push(infoWindow);
        
        infoWindow.open(window.map, marker);
        
        // 마커 클릭 시 정보창 토글
        naver.maps.Event.addListener(marker, 'click', function() {
            // 다른 정보창들 닫기
            window.infoWindows.forEach(iw => iw.close());
            // 현재 정보창 열기
            infoWindow.open(window.map, marker);
        });
        
        console.log(`마커 표시 완료: ${placeName} (${lat}, ${lng})`);
    } else {
        console.error('네이버 지도 API 또는 지도가 초기화되지 않았습니다.');
    }
}

// 장소 카드의 주소 정보 업데이트
function updatePlaceAddress(placeName, address) {
    const locationCards = document.querySelectorAll('.location-card');
    locationCards.forEach(card => {
        const nameElement = card.querySelector('.location-name');
        if (nameElement && nameElement.textContent === placeName) {
            const addressElement = card.querySelector('.location-address');
            if (addressElement) {
                addressElement.textContent = address;
            }
        }
    });
}

// 로딩 표시
function showLoading() {
    const loading = document.querySelector('.loading');
    if (loading) loading.style.display = 'block';
}

// 로딩 숨기기
function hideLoading() {
    const loading = document.querySelector('.loading');
    if (loading) loading.style.display = 'none';
}

// 에러 표시
function showError(message) {
    hideLoading();
    alert(message);
}

// 성공 메시지 표시
function showSuccessMessage(message) {
    hideLoading();
    
    // 성공 메시지 토스트 생성
    const toast = document.createElement('div');
    toast.className = 'alert alert-success alert-dismissible fade show position-fixed';
    toast.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    toast.innerHTML = `
        <i class="bi bi-check-circle me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(toast);
    
    // 5초 후 자동 제거
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 5000);
} 

const MY_PLACES_KEY = 'myPlaces:v1';
let myPlaces = [];
let myPlaceListEl = null;
let myListSortByEl = null;
let CURRENT_USER = null; // 로그인 사용자 정보

function loadMyPlaces() {
  try {
    return JSON.parse(localStorage.getItem(MY_PLACES_KEY)) || [];
  } catch {
    return [];
  }
}

function persistMyPlaces() {
  // 비로그인 상태에서는 로컬에 저장 (기존 동작 유지)
  localStorage.setItem(MY_PLACES_KEY, JSON.stringify(myPlaces));
}

// 로그인 상태 확인
async function fetchCurrentUser() {
  try {
    const r = await fetch('/auth/me');
    if (!r.ok) return null;
    const j = await r.json();
    return j.user || null;
  } catch { return null; }
}

// 최초 로그인 시: 로컬 → 서버 1회 업로드
async function migrateLocalToServerIfNeeded() {
  if (!CURRENT_USER) return;
  const flagKey = `myPlaces:migrated:${CURRENT_USER.id}`;
  if (localStorage.getItem(flagKey)) return;
  const local = loadMyPlaces();
  if (Array.isArray(local) && local.length) {
    for (const p of local) {
      try {
        await fetch('/api/my-places', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p)
        });
      } catch {}
    }
  }
  localStorage.setItem(flagKey, '1');
}

// 서버에서 최신 리스트 받아와 세팅
async function refreshMyPlacesFromServer() {
  try {
    const r = await fetch('/api/my-places');
    if (r.ok) {
      myPlaces = await r.json();
      renderMyPlaces();
    }
  } catch {}
}

function inferRegion(address) {
  if (!address) return '';
  // 우선 '구/군'을 잡고, 없으면 시/시·도
  const m1 = address.match(/[가-힣A-Za-z]+(구|군)/);
  if (m1) return m1[0];
  const m2 = address.match(/[가-힣A-Za-z]+(시|특별시|광역시|도)/);
  if (m2) return m2[0];
  return '';
}

function inferCategory(name = '', type = '') {
  const source = `${name} ${type}`.toLowerCase();
  if (/(카페|coffee|브런치|디저트|베이커리|빵|tart|케이크)/i.test(source)) return '카페/디저트';
  if (/(맛집|식당|레스토랑|밥집|한식|중식|일식|양식|고기|포차|분식|숯불|bar|pub)/i.test(source)) return '음식점';
  if (/(호텔|모텔|게스트하우스|리조트)/i.test(source)) return '숙박';
  if (/(공원|시장|플라자|몰|스퀘어|타워|갤러리|박물관)/i.test(source)) return '명소/여가';
  return type || '기타';
}

async function upsertPlace(place) {
  // place: {id?, name, address, lat, lng, region, category, createdAt}
  const key = (place.name || '') + '|' + (place.address || '');
  const idx = myPlaces.findIndex(p => ((p.name||'')+'|'+(p.address||'')) === key);
  if (idx >= 0) {
    myPlaces[idx] = { ...myPlaces[idx], ...place }; // 업데이트
  } else {
    myPlaces.push(place);
  }
  
  if (CURRENT_USER) {
    // 서버에 업서트
    try {
      await fetch('/api/my-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(myPlaces[idx >= 0 ? idx : (myPlaces.length - 1)])
      });
    } catch {}
    // 서버가 단일 소스 → 새로고침
    await refreshMyPlacesFromServer();
  } else {
    // 비로그인: 로컬 저장 유지
    persistMyPlaces();
    renderMyPlaces();
  }
}

async function removePlaceAt(i) {
  const place = myPlaces[i];
  if (CURRENT_USER && place.id) {
    // 서버에서 삭제
    try {
      await fetch(`/api/my-places/${place.id}`, { method: 'DELETE' });
    } catch {}
    // 서버에서 새로고침
    await refreshMyPlacesFromServer();
  } else {
    // 비로그인 또는 ID 없음: 로컬에서만 삭제
    myPlaces.splice(i, 1);
    persistMyPlaces();
    renderMyPlaces();
  }
}

function sortMyPlaces(list, sortBy) {
  return list.slice().sort((a, b) => {
    if (sortBy === 'createdAt-desc') {
      return new Date(b.createdAt) - new Date(a.createdAt);
    } else if (sortBy === 'createdAt-asc') {
      return new Date(a.createdAt) - new Date(b.createdAt);
    } else if (sortBy === 'name-asc') {
      return (a.name || '').localeCompare(b.name || '');
    }
    return 0;
  });
}

function renderMyPlaces() {
  if (!myPlaceListEl) return;
  const sortBy = myListSortByEl?.value || 'createdAt-desc';
  const sorted = sortMyPlaces(myPlaces, sortBy);

  myPlaceListEl.innerHTML = '';
  if (sorted.length === 0) {
    myPlaceListEl.innerHTML = '<li class="list-group-item">아직 저장된 장소가 없습니다.</li>';
    return;
  }

  sorted.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-start';
    li.innerHTML = `
      <div>
        <div class="fw-bold">${p.name || '(이름 없음)'}</div>
        ${p.address ? `<div class="text-muted small">${p.address}</div>` : ''}
        <div class="small mt-1">
          <span class="badge bg-light text-dark me-2">지역: ${p.region || '-'}</span>
          <span class="badge bg-secondary">카테고리: ${p.category || '-'}</span>
        </div>
      </div>
      <div class="d-flex gap-2">
        ${p.coordinates && p.coordinates.lat && p.coordinates.lng && 
          !isNaN(p.coordinates.lat) && !isNaN(p.coordinates.lng) && 
          p.coordinates.lat !== 0 && p.coordinates.lng !== 0 ? 
          `<button class="btn btn-sm btn-outline-primary map-btn" onclick="showOnMap('${p.name}', ${p.coordinates.lat}, ${p.coordinates.lng}, '${p.address || ''}')">
              <i class="bi bi-map"></i> 지도에서 보기
          </button>` : ''}
        <button class="btn btn-sm btn-outline-danger" data-remove="${i}">삭제</button>
      </div>
    `;
    myPlaceListEl.appendChild(li);
  });

  // 삭제 핸들러
  myPlaceListEl.querySelectorAll('button[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = Number(e.currentTarget.getAttribute('data-remove'));
      removePlaceAt(idx);
    });
  });
}



/***** =========================
 *   결과 리스트에 "저장" 버튼
 * ========================= *****/

// 장소명만 있는 경우(문자열 배열) → 네이버 검색으로 좌표/주소 resolve 후 저장
async function resolvePlaceViaNaver(query) {
  try {
    const res = await fetch('/search-place?query=' + encodeURIComponent(query));
    const data = await res.json();
    if (!data.items || data.items.length === 0) return null;

    const item = data.items[0];
    const lng = parseFloat(item.mapx) / 1e7;
    const lat = parseFloat(item.mapy) / 1e7;

    const name = (item.title || '').replace(/<[^>]*>/g, '');
    const address = item.roadAddress || item.address || '';
    return {
      name,
      address,
      lat,
      lng,
      region: inferRegion(address),
      category: inferCategory(name),
    };
  } catch (e) {
    console.error('resolvePlaceViaNaver error:', e);
    return null;
  }
}



// 장소를 지도에 표시하는 함수 (기존 함수와 통합)
function markOnMap(placeName, lat, lng, address = '') {
    if (typeof naver !== 'undefined' && naver.maps && window.map) {
        // 기존 마커들 제거
        if (window.markers) {
            window.markers.forEach(marker => marker.setMap(null));
        }
        window.markers = [];
        
        // 새로운 마커 생성
        const marker = new naver.maps.Marker({
            position: new naver.maps.LatLng(lat, lng),
            map: window.map,
            icon: {
                content: '<div class="custom-marker"><i class="bi bi-geo-alt-fill"></i></div>',
                size: new naver.maps.Size(40, 40),
                anchor: new naver.maps.Point(20, 20)
            }
        });
        
        window.markers.push(marker);
        
        // 지도 중심 이동
        window.map.setCenter(new naver.maps.LatLng(lat, lng));
        window.map.setZoom(15);
        
        // 정보창 표시
        const infoWindow = new naver.maps.InfoWindow({
            content: `
                <div class="info-window">
                    <h3>${placeName}</h3>
                    ${address ? `<p class="address">${address}</p>` : ''}
                </div>
            `,
            maxWidth: 200,
            backgroundColor: "#fff",
            borderColor: "#b39ddb",
            borderWidth: 2,
            anchorSize: new naver.maps.Size(20, 20),
            anchorColor: "#fff",
            pixelOffset: new naver.maps.Point(0, -20)
        });
        
        infoWindow.open(window.map, marker);
        
        // 마커 클릭 시 정보창 토글
        naver.maps.Event.addListener(marker, 'click', function() {
            if (infoWindow.getMap()) {
                infoWindow.close();
            } else {
                infoWindow.open(window.map, marker);
            }
        });
    }
}

// ================== NEW: 관련도 랭킹 호출 ==================
async function findBestPlaceFromText(mainText, hashtagsText='') {
  try {
    const payload = {
      ocrText: mainText,          // 이미지면 OCR 텍스트, 링크면 본문
      linkTitle: '',              // 있으면 채워도 됨
      linkDesc: '',
      instaCaption: '',
      hashtags: hashtagsText,     // '#홍대 #카페' 형태도 OK
      textKeywords: ['카페','디저트','브런치','라멘','스시','와인바','펍','바','버거','피자','파스타','한식','중식','양식'],
      menuHints: ['말차','크루아상','티라미수','라떼','규동','와인','스콘','케이크']
    };

    const resp = await fetch('/api/findBestPlace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    try {
      if (data && data.status === 'ok' && data.place) {
        const lng = data.place.mapx ? (parseFloat(data.place.mapx) / 1e7) : null;
        const lat = data.place.mapy ? (parseFloat(data.place.mapy) / 1e7) : null;
        const resultArray = [
          {
            name: data.place.name,
            type: data.place.category || '',
            coordinates: {
              lat: lat,
              lng: lng,
              address: data.place.address || ''
            }
          }
        ];
        showResults(resultArray);
      } else if (data && data.status === 'ambiguous' && Array.isArray(data.top3)) {
        const resultArray = data.top3.map(item => ({
          name: item.name,
          type: item.category || '',
          coordinates: { address: item.address || '' }
        }));
        showResults(resultArray);
      } else {
        showResults([]);
      }
    } catch (err) {
      console.error('render via showResults failed:', err);
    }
  } catch (e) {
    console.error('findBestPlaceFromText error:', e);
  }
}

// UI 렌더(자동 확정 또는 Top3)
function renderBestPlaceResult(data) {
  const listEl = document.getElementById('locationList');
  const resultBox = document.querySelector('.result-container');
  if (!listEl || !resultBox) return;

  const makeLi = (name, addr, reason='') => {
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-start';
    li.innerHTML = `
      <div>
        <div class="fw-bold">${name}</div>
        ${addr ? `<div class="text-muted small">${addr}</div>` : ''}
        ${reason ? `<div class="small text-success mt-1">${reason}</div>` : ''}
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-success" data-save>저장</button>
      </div>
    `;
    return li;
  };

  // 결과 박스 열기
  resultBox.style.display = 'block';

  if (data.status === 'ok') {
    // 기존 리스트 최상단에 “자동 확정” 항목을 하나 추가
    const li = makeLi(data.place.name, data.place.address, '자동 선택됨');
    listEl.prepend(li);

    // 지도 표시
    if (window.map && data.place.mapx && data.place.mapy) {
      const lng = parseFloat(data.place.mapx) / 1e7;
      const lat = parseFloat(data.place.mapy) / 1e7;
      const pos = new naver.maps.LatLng(lat, lng);
      if (window.marker) window.marker.setMap(null);
      window.marker = new naver.maps.Marker({ position: pos, map: window.map, title: data.place.name });
      window.map.setCenter(pos);
      window.map.setZoom(16);
    }

    // 저장 버튼
    li.querySelector('[data-save]')?.addEventListener('click', () => {
      const address = data.place.address || '';
      const payload = {
        name: data.place.name,
        address,
        lat: data.place.mapy ? (parseFloat(data.place.mapy)/1e7) : null,
        lng: data.place.mapx ? (parseFloat(data.place.mapx)/1e7) : null,
        region: inferRegion(address),
        category: inferCategory(data.place.name, data.place.category),
        createdAt: Date.now()
      };
      upsertPlace(payload);
      alert('리스트에 저장했습니다.');
    });

  } else if (data.status === 'ambiguous') {
    // Top3을 작은 선택 카드로 추가
    data.top3.forEach(item => {
      const li = makeLi(item.name, item.address, `점수 ${item.score}`);
      const chooseBtn = document.createElement('button');
      chooseBtn.className = 'btn btn-sm btn-outline-primary';
      chooseBtn.textContent = '이 장소 선택';
      chooseBtn.addEventListener('click', () => {
        // 선택 즉시 저장 및 지도 표시
        const address = item.address || '';
        const payload = {
          name: item.name,
          address,
          lat: null, lng: null, // mapx/mapy는 /api/findBestPlace 응답 top3에 없으므로, 필요시 /search-place로 resolve
          region: inferRegion(address),
          category: inferCategory(item.name, item.category),
          createdAt: Date.now()
        };
        upsertPlace(payload);
        alert('선택한 장소를 저장했습니다. (좌표는 필요 시 우측 "저장"에서 보완)');
      });
      li.querySelector('div.d-flex.gap-2')?.prepend(chooseBtn);
      listEl.prepend(li);
    });
  } else {
    // no_candidates 등
    const li = document.createElement('li');
    li.className = 'list-group-item text-muted';
    li.textContent = '관련도 높은 후보를 찾지 못했습니다.';
    listEl.prepend(li);
  }
}
// ================== /NEW ==================


async function searchPairsAndRender(pairs) {
  // 기존 마커 제거
  if (window.markers) window.markers.forEach(m => m.setMap(null));
  window.markers = [];
  window.infoWindows = [];

  const results = [];

  for (const p of pairs) {
    // 1순위: "가게명 + 주소", 2순위: "가게명", 3순위: "주소"
    const queries = [
      `${p.name} ${p.address}`,
      p.name,
      p.address
    ];

    let item = null;
    for (const q of queries) {
      try {
        const resp = await fetch(`/search-place?query=${encodeURIComponent(q)}`);
        const data = await resp.json();
        if (data.items && data.items.length) {
          item = data.items[0];
          break;
        }
      } catch (e) {}
    }

    const displayAddr = (item?.roadAddress || item?.address || p.address || '').trim();

    // 지도 마커
    if (item?.mapx && item?.mapy && window.naver?.maps && window.map) {
      const lng = parseFloat(item.mapx) / 1e7;
      const lat = parseFloat(item.mapy) / 1e7;
      markOnMap(p.name, lat, lng, displayAddr); // 이미 있는 함수 재사용
    }

    // 결과 배열에 추가
    results.push({
      name: p.name,
      type: item?.category || '',
      coordinates: {
        lat: item?.mapy ? (parseFloat(item.mapy) / 1e7) : null,
        lng: item?.mapx ? (parseFloat(item.mapx) / 1e7) : null,
        address: displayAddr || ''
      }
    });
  }

  showResults(results);
}
