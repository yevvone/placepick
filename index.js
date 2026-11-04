const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcrypt');

// 인증 미들웨어
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
};

// 메인 페이지
router.get('/', isAuthenticated, (req, res) => {
  res.render('index', {
    title: 'PlacePick - 장소 추천 서비스',
    user: req.user
  });
});

// 로그인 페이지
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.render('login', {
    title: '로그인',
    error: req.query.error
  });
});

// 회원가입 페이지
router.get('/register', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.render('register', {
    title: '회원가입',
    error: req.query.error
  });
});

// 회원가입 처리
router.post('/register', async (req, res) => {
  try {
    const { email, password, confirmPassword, username } = req.body;

    // 입력 검증
    if (!email || !password || !confirmPassword || !username) {
      return res.render('register', {
        title: '회원가입',
        error: '모든 필드를 입력해주세요.'
      });
    }

    if (password !== confirmPassword) {
      return res.render('register', {
        title: '회원가입',
        error: '비밀번호가 일치하지 않습니다.'
      });
    }

    if (password.length < 6) {
      return res.render('register', {
        title: '회원가입',
        error: '비밀번호는 6자 이상이어야 합니다.'
      });
    }

    const user = new User();
    
    // 이메일 중복 확인
    const emailExists = await user.isEmailExists(email);
    if (emailExists) {
      return res.render('register', {
        title: '회원가입',
        error: '이미 등록된 이메일입니다.'
      });
    }

    // 사용자 생성
    await user.createUser(email, password, username);
    
    res.redirect('/login?message=회원가입이 완료되었습니다. 로그인해주세요.');
  } catch (error) {
    console.error('회원가입 오류:', error);
    res.render('register', {
      title: '회원가입',
      error: '회원가입 중 오류가 발생했습니다.'
    });
  }
});

// 로그아웃
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('로그아웃 오류:', err);
    }
    res.redirect('/login');
  });
});

// 프로필 페이지
router.get('/profile', isAuthenticated, async (req, res) => {
  try {
    const user = new User();
    const userInfo = await user.getUserInfo(req.user);
    const favoritePlaces = await user.getFavoritePlaces(userInfo.id);
    
    res.render('profile', {
      title: '프로필',
      user: userInfo,
      favoritePlaces: favoritePlaces
    });
  } catch (error) {
    console.error('프로필 조회 오류:', error);
    res.redirect('/');
  }
});

// 프로필 업데이트
router.post('/profile', isAuthenticated, async (req, res) => {
  try {
    const { username, currentPassword, newPassword, confirmPassword } = req.body;
    const user = new User();
    const userInfo = await user.getUserInfo(req.user);
    
    const updates = {};
    
    if (username && username !== userInfo.username) {
      updates.username = username;
    }
    
    if (newPassword) {
      if (newPassword !== confirmPassword) {
        return res.render('profile', {
          title: '프로필',
          user: userInfo,
          error: '새 비밀번호가 일치하지 않습니다.'
        });
      }
      
      if (newPassword.length < 6) {
        return res.render('profile', {
          title: '프로필',
          user: userInfo,
          error: '새 비밀번호는 6자 이상이어야 합니다.'
        });
      }
      
      // 현재 비밀번호 확인
      const isValidPassword = await bcrypt.compare(currentPassword, userInfo.psword);
      if (!isValidPassword) {
        return res.render('profile', {
          title: '프로필',
          user: userInfo,
          error: '현재 비밀번호가 올바르지 않습니다.'
        });
      }
      
      updates.password = newPassword;
    }
    
    if (Object.keys(updates).length > 0) {
      await user.updateUser(req.user, updates);
      res.redirect('/profile?message=프로필이 업데이트되었습니다.');
    } else {
      res.redirect('/profile');
    }
  } catch (error) {
    console.error('프로필 업데이트 오류:', error);
    res.redirect('/profile?error=프로필 업데이트 중 오류가 발생했습니다.');
  }
});

// 즐겨찾기 장소 추가 API
router.post('/api/favorites', isAuthenticated, async (req, res) => {
  try {
    const { placeName, address, latitude, longitude } = req.body;
    const user = new User();
    const userInfo = await user.getUserInfo(req.user);
    
    await user.addFavoritePlace(userInfo.id, placeName, address, latitude, longitude);
    
    res.json({ success: true, message: '즐겨찾기에 추가되었습니다.' });
  } catch (error) {
    console.error('즐겨찾기 추가 오류:', error);
    res.status(500).json({ success: false, error: '즐겨찾기 추가에 실패했습니다.' });
  }
});

// 즐겨찾기 장소 조회 API
router.get('/api/favorites', isAuthenticated, async (req, res) => {
  try {
    const user = new User();
    const userInfo = await user.getUserInfo(req.user);
    const favoritePlaces = await user.getFavoritePlaces(userInfo.id);
    
    res.json({ success: true, data: favoritePlaces });
  } catch (error) {
    console.error('즐겨찾기 조회 오류:', error);
    res.status(500).json({ success: false, error: '즐겨찾기 조회에 실패했습니다.' });
  }
});

// 즐겨찾기 장소 삭제 API
router.delete('/api/favorites/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const user = new User();
    const userInfo = await user.getUserInfo(req.user);
    
    await user.removeFavoritePlace(userInfo.id, id);
    
    res.json({ success: true, message: '즐겨찾기에서 제거되었습니다.' });
  } catch (error) {
    console.error('즐겨찾기 삭제 오류:', error);
    res.status(500).json({ success: false, error: '즐겨찾기 삭제에 실패했습니다.' });
  }
});

module.exports = router;
