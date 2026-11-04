// OCR.space API를 통해 이미지를 업로드하고 텍스트를 추출하는 함수
// 사용법: ocrSpaceImage(imageBase64, language)
// imageBase64: data:image/... 형식의 base64 문자열
// language: 'kor' 또는 'eng' 등 (기본값: 'kor')

// base64 문자열의 크기를 바이트 단위로 계산
function base64Size(base64) {
    // data:image/...;base64, 접두사 제거
    let b64 = base64.split(',')[1] || base64;
    return Math.ceil((b64.length * 3) / 4);
}

// 이미지를 1024KB 이하로 압축 (canvas 사용, JPEG 품질 점진적 감소)
async function compressImageToMaxSize(base64, maxBytes = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = function() {
            let quality = 0.92;
            let canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            let compressed = canvas.toDataURL('image/jpeg', quality);
            while (base64Size(compressed) > maxBytes && quality > 0.1) {
                quality -= 0.07;
                compressed = canvas.toDataURL('image/jpeg', quality);
            }
            if (base64Size(compressed) > maxBytes) {
                reject(new Error('이미지를 1MB 이하로 압축할 수 없습니다.'));
            } else {
                resolve(compressed);
            }
        };
        img.onerror = reject;
        img.src = base64;
    });
}

async function ocrSpaceImage(imageBase64, language = 'kor') {
    const apiKey = 'K89835168188957'; // 무료 테스트 키, 실제 서비스 시 본인 키로 교체
    // 1024KB 초과 시 압축
    if (base64Size(imageBase64) > 1024 * 1024) {
        imageBase64 = await compressImageToMaxSize(imageBase64, 1024 * 1024);
    }
    const formData = new FormData();
    formData.append('base64Image', imageBase64);
    formData.append('language', language);
    formData.append('isOverlayRequired', 'false');
    formData.append('OCREngine', '2');

    const response = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: {
            'apikey': apiKey
        },
        body: formData
    });

    if (!response.ok) {
        throw new Error('OCR.space API 요청 실패');
    }
    const result = await response.json();
    if (result.IsErroredOnProcessing) {
        throw new Error(result.ErrorMessage || 'OCR 처리 중 오류 발생');
    }
    return result.ParsedResults && result.ParsedResults[0] ? result.ParsedResults[0].ParsedText : '';
}

const clientId = 'dv09yJvf1T8W4_pyPYjs';
const clientSecret = 'k4ncKS6rkV';

// 1. OCR/URL에서 추출된 장소명(예: "성신여대")
const placeName = "성신여대";

// 2. 네이버 지역 검색 API로 정확한 주소/좌표 획득
fetch('/search-place?query=' + encodeURIComponent(placeName))
  .then(res => res.json())
  .then(data => {
    if (!data.items || data.items.length === 0) {
      alert('정확한 장소를 찾을 수 없습니다.');
      return;
    }
    const item = data.items[0];
    const lng = parseFloat(item.mapx) / 1e7;
    const lat = parseFloat(item.mapy) / 1e7;
    // 3. 지도에 마커 표시
    const point = new naver.maps.LatLng(lat, lng);
    if (window.marker) window.marker.setMap(null);
    window.marker = new naver.maps.Marker({ position: point, map: window.map });
    window.map.setCenter(point);
    window.map.setZoom(15);
  });

async function markPlacesFromExtracted(placeNames) {
  console.log('=== markPlacesFromExtracted 시작 ===');
  console.log('입력받은 장소명들:', placeNames);
  
  if (!placeNames || placeNames.length === 0) {
    console.log('장소명이 없습니다.');
    return Promise.resolve();
  }

  // 여러 검색 방법 시도
  for (let i = 0; i < placeNames.length; i++) {
    const placeName = placeNames[i];
    console.log(`\n=== 검색 시도 ${i + 1}: "${placeName}" ===`);
    
    // 1. 원본 검색어로 시도
    let result = await trySearchPlace(placeName);
    
    if (!result && placeName.includes(' ')) {
      // 2. 공백 제거해서 시도
      const noSpaceName = placeName.replace(/\s+/g, '');
      console.log(`공백 제거 검색: "${noSpaceName}"`);
      result = await trySearchPlace(noSpaceName);
    }
    
    if (!result && placeName.includes('구') && placeName.includes('로')) {
      // 3. 주소인 경우 구와 로/길만 추출해서 시도
      const simplified = placeName.match(/([가-힣]+구)\s+([가-힣A-Za-z0-9]+(?:로|길))/);
      if (simplified) {
        const simpleQuery = `${simplified[1]} ${simplified[2]}`;
        console.log(`간소화된 주소 검색: "${simpleQuery}"`);
        result = await trySearchPlace(simpleQuery);
      }
    }
    
    if (!result && placeName.length > 10) {
      // 4. 너무 긴 검색어는 앞부분만 시도
      const shortName = placeName.substring(0, 10);
      console.log(`짧은 이름 검색: "${shortName}"`);
      result = await trySearchPlace(shortName);
    }
    
    if (!result && /[가-힣]+(타르트|카페|베이커리|빵집)/.test(placeName)) {
      // 5. 업종별 키워드 포함 검색
      const businessMatch = placeName.match(/([가-힣A-Za-z0-9]+)(타르트|카페|베이커리|빵집)/);
      if (businessMatch) {
        const businessName = businessMatch[1] + businessMatch[2];
        console.log(`업종 키워드 검색: "${businessName}"`);
        result = await trySearchPlace(businessName);
      }
    }
    
    if (result) {
      console.log(`✅ 검색 성공! "${placeName}"으로 장소를 찾았습니다.`);
      return Promise.resolve(); // 성공하면 더 이상 시도하지 않음
    }
  }
  
  console.log('❌ 모든 검색어로 시도했지만 장소를 찾을 수 없습니다.');
  return Promise.resolve();
}

// 개별 장소 검색 함수
async function trySearchPlace(query) {
  try {
    console.log(`네이버 API 검색 시도: "${query}"`);
    
    const response = await fetch('/search-place?query=' + encodeURIComponent(query));
    const data = await response.json();
    
    console.log(`검색 결과:`, data.items?.length || 0, '개');
    
    if (data.items && data.items.length > 0) {
      const item = data.items[0];
      console.log(`선택된 장소:`, item.title);
      
      const lng = parseFloat(item.mapx) / 1e7;
      const lat = parseFloat(item.mapy) / 1e7;
      
      // 지도에 마커 표시
      const title = item.title.replace(/<[^>]*>/g, '');
      const address = item.roadAddress || item.address;
      
      console.log('지도 마커 생성:', { lat, lng, title, address });
      
      // markOnMap 함수가 있다면 호출, 없으면 기본 마커 생성
      if (typeof markOnMap === 'function') {
        markOnMap(lat, lng, title, address);
      } else {
        // 기본 마커 생성 로직
        if (window.map) {
          const position = new naver.maps.LatLng(lat, lng);
          
          // 기존 마커 제거
          if (window.marker) {
            window.marker.setMap(null);
          }
          
          // 새 마커 생성
          window.marker = new naver.maps.Marker({
            position: position,
            map: window.map,
            title: title
          });
          
          // 지도 중심 이동
          window.map.setCenter(position);
          window.map.setZoom(16);
          
          console.log('✅ 마커가 지도에 표시되었습니다!');
        }
      }
      
      return true; // 성공
    }
    
    return false; // 실패
  } catch (error) {
    console.error(`검색 중 오류:`, error);
    return false;
  }
} 