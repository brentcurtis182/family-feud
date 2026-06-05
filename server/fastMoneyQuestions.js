// Curated Fast Money questions — the classic framings ("We asked 100 married
// women…", "On a scale of 1 to 10…", "How many…") that give Fast Money its
// flavor. Drawn from on the Bank source so they're free. Shape matches the bank:
// { text, answers: [{ text, points }] } with points roughly summing to 100.
module.exports = [
  // ---- "Name…" classics ----
  { text: 'Name something people do to relax after a long day.', answers: [
    { text: 'Watch TV', points: 30 }, { text: 'Have a drink', points: 19 },
    { text: 'Take a nap', points: 16 }, { text: 'Read', points: 13 },
    { text: 'Take a bath', points: 12 }, { text: 'Exercise', points: 10 } ] },
  { text: 'Name a food people eat with their hands.', answers: [
    { text: 'Pizza', points: 28 }, { text: 'Chicken wings', points: 21 },
    { text: 'Burger', points: 17 }, { text: 'Fries', points: 14 },
    { text: 'Tacos', points: 12 }, { text: 'Corn on the cob', points: 8 } ] },
  { text: "Name something you'd find in a woman's purse.", answers: [
    { text: 'Wallet', points: 26 }, { text: 'Phone', points: 21 },
    { text: 'Makeup', points: 18 }, { text: 'Keys', points: 15 },
    { text: 'Gum', points: 11 }, { text: 'Tissues', points: 9 } ] },
  { text: "Name something people do in the shower besides wash.", answers: [
    { text: 'Sing', points: 34 }, { text: 'Think', points: 21 },
    { text: 'Pee', points: 16 }, { text: 'Cry', points: 12 },
    { text: 'Shave', points: 11 }, { text: 'Brush teeth', points: 6 } ] },
  { text: 'Name something you blow up.', answers: [
    { text: 'Balloon', points: 38 }, { text: 'Tire', points: 19 },
    { text: 'Air mattress', points: 15 }, { text: 'Bubble gum', points: 12 },
    { text: 'Beach ball', points: 10 }, { text: 'A building', points: 6 } ] },
  { text: "Name something you'd hate to find in your soup.", answers: [
    { text: 'A hair', points: 32 }, { text: 'A bug', points: 26 },
    { text: 'A band-aid', points: 14 }, { text: 'A tooth', points: 12 },
    { text: 'Dirt', points: 10 }, { text: 'A fingernail', points: 6 } ] },
  { text: 'Name something people are afraid of.', answers: [
    { text: 'Spiders', points: 27 }, { text: 'Heights', points: 22 },
    { text: 'Snakes', points: 17 }, { text: 'The dark', points: 13 },
    { text: 'Death', points: 11 }, { text: 'Clowns', points: 10 } ] },
  { text: 'Name something people do at a red light.', answers: [
    { text: 'Check their phone', points: 30 }, { text: 'Put on makeup', points: 18 },
    { text: 'Sing', points: 16 }, { text: 'Eat', points: 14 },
    { text: 'Pick their nose', points: 13 }, { text: 'Yell at traffic', points: 9 } ] },
  { text: 'Name a reason you might call in sick when you really aren’t.', answers: [
    { text: 'Hungover', points: 26 }, { text: 'Just tired', points: 22 },
    { text: 'Nice weather', points: 16 }, { text: 'Job interview', points: 14 },
    { text: 'Mental health day', points: 12 }, { text: 'A date', points: 10 } ] },
  { text: 'Name something a dog does that drives its owner crazy.', answers: [
    { text: 'Barks too much', points: 27 }, { text: 'Chews things', points: 21 },
    { text: 'Has accidents', points: 17 }, { text: 'Digs', points: 13 },
    { text: 'Begs for food', points: 12 }, { text: 'Runs off', points: 10 } ] },
  { text: 'Name a fruit you have to peel before eating.', answers: [
    { text: 'Banana', points: 35 }, { text: 'Orange', points: 26 },
    { text: 'Mango', points: 12 }, { text: 'Kiwi', points: 10 },
    { text: 'Pineapple', points: 9 }, { text: 'Avocado', points: 8 } ] },
  { text: 'Name a job that requires a uniform.', answers: [
    { text: 'Police officer', points: 24 }, { text: 'Nurse', points: 20 },
    { text: 'Soldier', points: 16 }, { text: 'Firefighter', points: 14 },
    { text: 'Chef', points: 14 }, { text: 'Pilot', points: 12 } ] },
  { text: "Name something you'd find under a kid's bed.", answers: [
    { text: 'Toys', points: 29 }, { text: 'Dust bunnies', points: 20 },
    { text: 'Socks', points: 16 }, { text: 'Snacks', points: 14 },
    { text: 'A monster', points: 12 }, { text: 'Lost homework', points: 9 } ] },
  { text: 'Name something people pretend to like but secretly hate.', answers: [
    { text: 'Fruitcake', points: 23 }, { text: 'Their job', points: 20 },
    { text: 'Their in-laws', points: 18 }, { text: 'A bad gift', points: 16 },
    { text: 'Small talk', points: 13 }, { text: 'Mondays', points: 10 } ] },

  // ---- "We asked 100…" framings ----
  { text: 'We asked 100 married women: name something your husband does that drives you crazy.', answers: [
    { text: 'Leaves a mess', points: 26 }, { text: 'Snores', points: 20 },
    { text: "Doesn't listen", points: 18 }, { text: 'Burps', points: 14 },
    { text: 'Leaves the toilet seat up', points: 12 }, { text: 'Spends money', points: 9 } ] },
  { text: 'We asked 100 married men: name something your wife nags you about.', answers: [
    { text: 'Doing chores', points: 30 }, { text: 'Money', points: 22 },
    { text: 'Being late', points: 16 }, { text: 'Not listening', points: 14 },
    { text: 'His friends', points: 10 }, { text: 'Leaving a mess', points: 8 } ] },
  { text: "We asked 100 women: name something you wish your man would do more often.", answers: [
    { text: 'Help around the house', points: 26 }, { text: 'Give compliments', points: 22 },
    { text: 'Be romantic', points: 18 }, { text: 'Listen', points: 16 },
    { text: 'Plan date nights', points: 10 }, { text: 'Surprise her', points: 8 } ] },
  { text: 'We asked 100 men: name something you would do if you were invisible for a day.', answers: [
    { text: 'Spy on people', points: 25 }, { text: 'Rob a bank', points: 22 },
    { text: 'Sneak into events', points: 18 }, { text: 'Prank people', points: 15 },
    { text: 'Travel for free', points: 12 }, { text: 'Hear gossip', points: 8 } ] },
  { text: 'We asked 100 people: name a chore you absolutely hate doing.', answers: [
    { text: 'Dishes', points: 24 }, { text: 'Laundry', points: 20 },
    { text: 'Cleaning the bathroom', points: 18 }, { text: 'Vacuuming', points: 14 },
    { text: 'Taking out the trash', points: 13 }, { text: 'Mopping', points: 11 } ] },

  // ---- "On a scale of 1 to 10…" (number answers) ----
  { text: 'On a scale of 1 to 10, how good a cook is the average person?', answers: [
    { text: '7', points: 26 }, { text: '8', points: 22 }, { text: '6', points: 16 },
    { text: '5', points: 14 }, { text: '9', points: 12 }, { text: '10', points: 10 } ] },
  { text: 'On a scale of 1 to 10, how romantic is the average man?', answers: [
    { text: '5', points: 24 }, { text: '6', points: 20 }, { text: '7', points: 16 },
    { text: '4', points: 14 }, { text: '8', points: 14 }, { text: '3', points: 12 } ] },
  { text: 'On a scale of 1 to 10, how stressful is planning a wedding?', answers: [
    { text: '9', points: 26 }, { text: '10', points: 24 }, { text: '8', points: 20 },
    { text: '7', points: 14 }, { text: '6', points: 10 }, { text: '5', points: 6 } ] },

  // ---- "How many…" (number answers) ----
  { text: 'How many times a day does the average person check their phone?', answers: [
    { text: '50', points: 24 }, { text: '100', points: 20 }, { text: '20', points: 17 },
    { text: '10', points: 15 }, { text: '200', points: 14 }, { text: '5', points: 10 } ] },
  { text: 'How many hours of sleep does the average person get a night?', answers: [
    { text: '8', points: 34 }, { text: '7', points: 27 }, { text: '6', points: 18 },
    { text: '5', points: 11 }, { text: '9', points: 6 }, { text: '4', points: 4 } ] },
  { text: 'How many cups of coffee does the average person drink in a day?', answers: [
    { text: '2', points: 31 }, { text: '3', points: 24 }, { text: '1', points: 20 },
    { text: '4', points: 14 }, { text: '5', points: 7 }, { text: '6', points: 4 } ] },
  { text: 'How many slices of pizza can the average person eat in one sitting?', answers: [
    { text: '3', points: 30 }, { text: '4', points: 25 }, { text: '2', points: 18 },
    { text: '5', points: 13 }, { text: '6', points: 8 }, { text: '8', points: 6 } ] },

  // ---- "At what age…" ----
  { text: 'At what age does a person officially become "old"?', answers: [
    { text: '60', points: 24 }, { text: '70', points: 22 }, { text: '65', points: 17 },
    { text: '50', points: 14 }, { text: '80', points: 13 }, { text: '40', points: 10 } ] },

  // ---- more "Name…" for volume ----
  { text: 'Name something that makes you cry.', answers: [
    { text: 'Onions', points: 30 }, { text: 'A sad movie', points: 24 },
    { text: 'Death of a loved one', points: 16 }, { text: 'Pain', points: 12 },
    { text: 'Pure joy', points: 10 }, { text: 'Allergies', points: 8 } ] },
  { text: 'Name a sport where you might lose a tooth.', answers: [
    { text: 'Hockey', points: 34 }, { text: 'Boxing', points: 24 },
    { text: 'Football', points: 16 }, { text: 'Basketball', points: 12 },
    { text: 'Rugby', points: 8 }, { text: 'Baseball', points: 6 } ] },
  { text: 'Name something people do when they’re nervous.', answers: [
    { text: 'Bite their nails', points: 26 }, { text: 'Pace around', points: 20 },
    { text: 'Sweat', points: 16 }, { text: 'Fidget', points: 14 },
    { text: 'Talk fast', points: 13 }, { text: 'Shake their leg', points: 9 } ] },
  { text: 'Name a place you would hate to run out of gas.', answers: [
    { text: 'The highway', points: 30 }, { text: 'The desert', points: 18 },
    { text: 'Middle of nowhere', points: 16 }, { text: 'On a bridge', points: 13 },
    { text: 'A bad neighborhood', points: 13 }, { text: 'On a date', points: 8 } ] },
  { text: 'Name something a person does to look younger.', answers: [
    { text: 'Dye their hair', points: 24 }, { text: 'Wear makeup', points: 22 },
    { text: 'Get Botox', points: 18 }, { text: 'Exercise', points: 14 },
    { text: 'Dress younger', points: 12 }, { text: 'Get surgery', points: 10 } ] },
  { text: 'Name something you do at a wedding.', answers: [
    { text: 'Dance', points: 26 }, { text: 'Eat', points: 22 },
    { text: 'Drink', points: 18 }, { text: 'Cry', points: 12 },
    { text: 'Catch the bouquet', points: 12 }, { text: 'Give a toast', points: 10 } ] },
];
