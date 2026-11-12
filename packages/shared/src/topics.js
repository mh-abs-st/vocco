// The starter topic library. `prompt` is what the coach asks you; `side` topics are debate motions you can argue
// for or against. Keep prompts short, concrete and answerable in 1–3 minutes.

/** @typedef {{ id: string, category: string, title: string, prompt: string, level: 1|2|3, motion?: boolean }} Topic */

export const CATEGORIES = [
  { id: 'everyday', label: 'Everyday' },
  { id: 'work', label: 'Work' },
  { id: 'interview', label: 'Interviews' },
  { id: 'pitch', label: 'Pitches' },
  { id: 'speech', label: 'Speeches & toasts' },
  { id: 'debate', label: 'Debate motions' },
  { id: 'explain', label: 'Explain it' },
];

/** @type {Topic[]} */
export const TOPICS = [
  // Everyday
  { id: 'e1', category: 'everyday', level: 1, title: 'A place you love', prompt: 'Describe a place you love and make us want to go there.' },
  { id: 'e2', category: 'everyday', level: 1, title: 'Best advice', prompt: 'What is the best advice you have ever been given, and how did it change what you do?' },
  { id: 'e3', category: 'everyday', level: 1, title: 'A small habit', prompt: 'Tell us about one small habit that makes your days better.' },
  { id: 'e4', category: 'everyday', level: 2, title: 'Changed your mind', prompt: 'Tell the story of a time you changed your mind about something important.' },
  { id: 'e5', category: 'everyday', level: 2, title: 'A skill to learn', prompt: 'Which skill would you learn if you had a free year, and why that one?' },
  { id: 'e6', category: 'everyday', level: 1, title: 'Recommend a book or film', prompt: 'Recommend a book or film to someone who has never heard of it.' },
  { id: 'e7', category: 'everyday', level: 2, title: 'Your hometown', prompt: 'What does your hometown get right that other places get wrong?' },
  { id: 'e8', category: 'everyday', level: 2, title: 'A mistake that helped', prompt: 'Describe a mistake that ended up helping you.' },
  // Work
  { id: 'w1', category: 'work', level: 1, title: 'Weekly update', prompt: 'Give your team a two-minute update: what you finished, what is next, and what you need.' },
  { id: 'w2', category: 'work', level: 2, title: 'Delay news', prompt: 'Tell a client that their project will be two weeks late, and what you will do about it.' },
  { id: 'w3', category: 'work', level: 2, title: 'Propose a change', prompt: 'Propose one change to how your team works and win the room over.' },
  { id: 'w4', category: 'work', level: 3, title: 'Push back', prompt: 'Your manager wants a feature you think is a mistake. Make your case respectfully.' },
  { id: 'w5', category: 'work', level: 2, title: 'Run a meeting kickoff', prompt: 'Open a meeting: the goal, the agenda, and what a good outcome looks like.' },
  { id: 'w6', category: 'work', level: 3, title: 'Ask for a raise', prompt: 'Ask for a raise, using your results as the reason.' },
  { id: 'w7', category: 'work', level: 2, title: 'Thank a colleague', prompt: 'Thank a colleague in front of the team for something specific they did.' },
  { id: 'w8', category: 'work', level: 3, title: 'Explain an incident', prompt: 'Explain to leadership what went wrong in an outage and how it won’t happen again.' },
  // Interviews
  { id: 'i1', category: 'interview', level: 1, title: 'Tell me about yourself', prompt: 'Tell me about yourself.' },
  { id: 'i2', category: 'interview', level: 2, title: 'Why this job', prompt: 'Why do you want this job, and why should we pick you?' },
  { id: 'i3', category: 'interview', level: 2, title: 'A hard problem', prompt: 'Tell me about the hardest problem you solved and how you did it.' },
  { id: 'i4', category: 'interview', level: 2, title: 'A conflict', prompt: 'Describe a disagreement with a colleague and how you resolved it.' },
  { id: 'i5', category: 'interview', level: 2, title: 'A failure', prompt: 'Tell me about a time you failed and what you learned.' },
  { id: 'i6', category: 'interview', level: 3, title: 'Leading without authority', prompt: 'Tell me about a time you led people who didn’t report to you.' },
  { id: 'i7', category: 'interview', level: 1, title: 'Strengths', prompt: 'What are your two biggest strengths, with an example of each?' },
  { id: 'i8', category: 'interview', level: 3, title: 'Five years', prompt: 'Where do you want to be in five years, and how does this role get you there?' },
  // Pitches
  { id: 'p1', category: 'pitch', level: 1, title: 'Elevator pitch', prompt: 'Pitch yourself in 60 seconds to someone you’d like to work with.' },
  { id: 'p2', category: 'pitch', level: 2, title: 'Pitch a product', prompt: 'Pitch a product you use every day as if you were its founder.' },
  { id: 'p3', category: 'pitch', level: 3, title: 'Startup to investors', prompt: 'Pitch a startup idea to investors: the problem, your solution, and why now.' },
  { id: 'p4', category: 'pitch', level: 2, title: 'Sell an idea internally', prompt: 'Convince your company to fund a small project you care about.' },
  { id: 'p5', category: 'pitch', level: 2, title: 'Sell a used item', prompt: 'Sell your old phone, bike or laptop to a doubtful buyer.' },
  { id: 'p6', category: 'pitch', level: 3, title: 'Win a client', prompt: 'You have three minutes with a big potential client. Win the next meeting.' },
  // Speeches & toasts
  { id: 's1', category: 'speech', level: 1, title: 'Birthday toast', prompt: 'Give a short birthday toast for a close friend.' },
  { id: 's2', category: 'speech', level: 2, title: 'Wedding toast', prompt: 'Give a wedding toast that is warm, a little funny, and short.' },
  { id: 's3', category: 'speech', level: 2, title: 'Farewell to a colleague', prompt: 'Say goodbye to a colleague who is leaving after many years.' },
  { id: 's4', category: 'speech', level: 3, title: 'Graduation speech', prompt: 'Give a short graduation speech with one idea the graduates will remember.' },
  { id: 's5', category: 'speech', level: 2, title: 'Award thank-you', prompt: 'You just won an award. Accept it and thank the right people in under two minutes.' },
  { id: 's6', category: 'speech', level: 3, title: 'Rally the team', prompt: 'Your team just lost a big deal. Rally them for the next quarter.' },
  // Debate motions
  { id: 'd1', category: 'debate', level: 2, motion: true, title: 'Remote work', prompt: 'This house believes remote work is better than office work.' },
  { id: 'd2', category: 'debate', level: 2, motion: true, title: 'Social media age limit', prompt: 'This house would ban social media for under-16s.' },
  { id: 'd3', category: 'debate', level: 3, motion: true, title: 'Universal basic income', prompt: 'This house supports a universal basic income.' },
  { id: 'd4', category: 'debate', level: 2, motion: true, title: 'Homework', prompt: 'This house would abolish homework in primary schools.' },
  { id: 'd5', category: 'debate', level: 3, motion: true, title: 'AI in schools', prompt: 'This house believes students should be allowed to use AI for coursework.' },
  { id: 'd6', category: 'debate', level: 2, motion: true, title: 'Four-day week', prompt: 'This house would introduce a four-day working week.' },
  { id: 'd7', category: 'debate', level: 3, motion: true, title: 'Space exploration', prompt: 'This house believes money spent on space exploration is well spent.' },
  { id: 'd8', category: 'debate', level: 2, motion: true, title: 'Cars in city centres', prompt: 'This house would ban private cars from city centres.' },
  { id: 'd9', category: 'debate', level: 3, motion: true, title: 'Voting age 16', prompt: 'This house would lower the voting age to 16.' },
  { id: 'd10', category: 'debate', level: 2, motion: true, title: 'Tipping', prompt: 'This house would end tipping in restaurants.' },
  // Explain it
  { id: 'x1', category: 'explain', level: 1, title: 'How the internet works', prompt: 'Explain how the internet works to a curious 12-year-old.' },
  { id: 'x2', category: 'explain', level: 2, title: 'Your job to a stranger', prompt: 'Explain what you do at work to someone outside your field.' },
  { id: 'x3', category: 'explain', level: 2, title: 'Inflation', prompt: 'Explain inflation and why it matters, without jargon.' },
  { id: 'x4', category: 'explain', level: 1, title: 'A recipe', prompt: 'Walk us through how to cook your favourite simple dish.' },
  { id: 'x5', category: 'explain', level: 3, title: 'A hard concept', prompt: 'Explain the hardest idea in your field so a beginner gets it.' },
  { id: 'x6', category: 'explain', level: 2, title: 'Why sleep matters', prompt: 'Explain why sleep matters and give two tips people can use tonight.' },
];

export const topicById = (id) => TOPICS.find((t) => t.id === id) || null;

/** A random topic, optionally from one category. */
export function randomTopic(category, rand = Math.random) {
  const pool = category ? TOPICS.filter((t) => t.category === category) : TOPICS;
  return pool[Math.floor(rand() * pool.length)] || TOPICS[0];
}
