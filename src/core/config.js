// Конфиг Яси — единый источник правды для констант (без логики, только значения).
// Грузится ПЕРЕД pet.js (см. manifest content_scripts[0].js и background.js JS),
// кладёт всё в window.Yasia.config. Меняешь баланс/физику — только здесь.
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  Yasia.config = Object.freeze({
    // движение
    SPEED: 1.0,            // базовая скорость ходьбы
    RUN_MUL: 2.6,         // во сколько раз быстрее во время бега

    // платформер по структуре страницы
    PLAT_GRAVITY: 1.0,    // ускорение падения
    PLAT_JUMP_UP: 150,    // макс высота прыжка вверх (px экрана)
    PLAT_JUMP_DX: 230,    // макс горизонтальная дальность прыжка
    PLAT_JUMP_MS: 640,    // длительность дуги прыжка
    PLAT_FLOOR: 4,        // отступ «пола» от низа экрана

    ARRIVE: 12,
    STAND_GAP: 10,
    NEAR: 80,
    SCAN_MS: 650,
    BEG_TIMEOUT: 7000,
    HAPPY_MS: 900,
    SNUB_MS: 9000,
    STABLE_FRAMES: 3,
    VIEW_PAD_TOP: 64,
    VIEW_PAD_BOTTOM: 24,
    PET_W: 46,
    PET_H: 62,

    // взрыв по наведению
    HOVER_R: 64,          // радиус «курсор рядом»
    FUSE_MS: 2000,        // держать курсор у питомца, чтобы рвануло

    // голод / опыт / уровни
    HUNGER_PER_MIN: 1.4,  // прирост голода в минуту (0..100)
    FEED_AMOUNT: 34,      // сколько голода снимает одна кормёжка
    FEED_XP: 12,
    LIKE_XP: 6,
    LEVEL_XP: [0, 40, 100, 200, 350], // пороги опыта для уровней 1..5
    MAX_LEVEL: 5,
  });
})();
