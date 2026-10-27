// Tuning values and fictional names. Change numbers here, not in game.js.
window.GAME_CONFIG = {
  names: {
    country: "Русия",
    politician: "Илияна Йодова",
    masthead: "Вестник Елфи Нюз",
    fakePages: [
      "Копейкин",
      "Капутин",
      "Зелената Чорапчица",
      "Пуйло",
    ]
  },

  game: {
    days: 7,
    eventsPerDay: 2,
    eventDurationMs: 15000,
    startValues: { money: 50, friendship: 20, pr: 50 },
    stat: { min: 0, max: 100 },        // applies to friendship and PR
    winThreshold: 50,                  // PR needed when the week ends
    interviewTimeoutAnswer: "evasive"  // used when the player does not answer in time
  },

  // Checked top to bottom. The first band whose min is reached wins.
  moodBands: [
    { key: "happy", min: 67 },
    { key: "neutral", min: 34 },
    { key: "worried", min: 0 }
  ],

  eventWeights: { satire: 30, news: 30, interview: 40 },

  scandal: {
    chancePerPardon: 0.10,
    maxChance: 0.60
  },

  // Each value is a fixed number or a [min, max] range rolled when the event appears.
  effects: {
    satireMock: { pr: [-10, -5] },
    satireFan: { pr: [4, 6] },
    news: { pr: [-8, -4] },
    scandal: { pr: [-15, -10] },
    interview: {
      praise: { friendship: 12, pr: -3 },
      evasive: { pr: -2 },
      insult: { friendship: -2, pr: -5 }
    }
  },

  // effect values are changes. Negative values are costs and must be affordable.
  actions: {
    minister: { cooldownMs: 20000, effect: { friendship: -15, pr: 10 }, hasNpcImage: true },
    influencer: { cooldownMs: 30000, effect: { money: -30, pr: 12 }, hasNpcImage: true },
    pardon: { cooldownMs: 10000, effect: { money: 20 }, hasNpcImage: false, isPardon: true }
  },

  reactionIcons: ["👍", "😂", "😡", "😮"],

  assets: {
    moods: "assets/moods/",
    npcs: "assets/npcs/",
    thumbs: "assets/thumbs/"
  }
};
