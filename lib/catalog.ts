export type ShelfBook = {
  id: number;
  title: string;
  author: string;
  year?: string;
  /** 1 = approachable, 5 = brutal. Sets the default scaffolding level. */
  difficulty: 1 | 2 | 3 | 4 | 5;
  note?: string;
};

export type Shelf = { author: string; blurb: string; books: ShelfBook[] };

export const SHELVES: Shelf[] = [
  {
    author: "Charles Dickens",
    blurb:
      "Sentences that run for half a page and a cast of forty. The trouble is rarely the words — it is keeping hold of the thread.",
    books: [
      { id: 46, title: "A Christmas Carol", author: "Charles Dickens", year: "1843", difficulty: 2, note: "The gentlest way in. Short, and you already know the shape of it." },
      { id: 1400, title: "Great Expectations", author: "Charles Dickens", year: "1861", difficulty: 3, note: "First person, clear plot. The best full-length starting point." },
      { id: 98, title: "A Tale of Two Cities", author: "Charles Dickens", year: "1859", difficulty: 3 },
      { id: 730, title: "Oliver Twist", author: "Charles Dickens", year: "1838", difficulty: 3 },
      { id: 786, title: "Hard Times", author: "Charles Dickens", year: "1854", difficulty: 3, note: "His shortest novel." },
      { id: 766, title: "David Copperfield", author: "Charles Dickens", year: "1850", difficulty: 3 },
      { id: 1023, title: "Bleak House", author: "Charles Dickens", year: "1853", difficulty: 5, note: "Two narrators, a lawsuit nobody understands. Keep the tracker on." },
      { id: 963, title: "Little Dorrit", author: "Charles Dickens", year: "1857", difficulty: 4 },
      { id: 883, title: "Our Mutual Friend", author: "Charles Dickens", year: "1865", difficulty: 4 },
      { id: 580, title: "The Pickwick Papers", author: "Charles Dickens", year: "1837", difficulty: 4 },
      { id: 967, title: "Nicholas Nickleby", author: "Charles Dickens", year: "1839", difficulty: 4 },
      { id: 700, title: "The Old Curiosity Shop", author: "Charles Dickens", year: "1841", difficulty: 4 },
      { id: 821, title: "Dombey and Son", author: "Charles Dickens", year: "1848", difficulty: 4 },
      { id: 968, title: "Martin Chuzzlewit", author: "Charles Dickens", year: "1844", difficulty: 4 },
      { id: 917, title: "Barnaby Rudge", author: "Charles Dickens", year: "1841", difficulty: 4 },
      { id: 564, title: "The Mystery of Edwin Drood", author: "Charles Dickens", year: "1870", difficulty: 3, note: "Unfinished — he died mid-sentence, more or less." },
      { id: 882, title: "Sketches by Boz", author: "Charles Dickens", year: "1836", difficulty: 3 },
      { id: 914, title: "The Uncommercial Traveller", author: "Charles Dickens", year: "1861", difficulty: 3 },
      { id: 675, title: "American Notes", author: "Charles Dickens", year: "1842", difficulty: 3 },
    ],
  },
  {
    author: "Friedrich Nietzsche",
    blurb:
      "Not hard because of vocabulary — hard because each aphorism assumes an argument he made somewhere else. Read slowly; one section is a full sitting.",
    books: [
      { id: 19322, title: "The Antichrist", author: "Friedrich Nietzsche", year: "1895", difficulty: 3, note: "Short, furious, and unusually direct for him." },
      { id: 52263, title: "Twilight of the Idols", author: "Friedrich Nietzsche", year: "1889", difficulty: 3, note: "He called it a summary of his whole philosophy. Best first Nietzsche." },
      { id: 52319, title: "The Genealogy of Morals", author: "Friedrich Nietzsche", year: "1887", difficulty: 4, note: "Three connected essays — the closest he gets to a normal book." },
      { id: 4363, title: "Beyond Good and Evil", author: "Friedrich Nietzsche", year: "1886", difficulty: 4 },
      { id: 1998, title: "Thus Spake Zarathustra", author: "Friedrich Nietzsche", year: "1883", difficulty: 5, note: "Written as scripture parody. Beautiful, and the hardest thing here." },
      { id: 52190, title: "Ecce Homo", author: "Friedrich Nietzsche", year: "1888", difficulty: 3, note: "His autobiography. Chapters titled 'Why I Am So Clever'." },
      { id: 51356, title: "The Birth of Tragedy", author: "Friedrich Nietzsche", year: "1872", difficulty: 4 },
      { id: 52881, title: "The Joyful Wisdom (The Gay Science)", author: "Friedrich Nietzsche", year: "1882", difficulty: 4 },
      { id: 39955, title: "The Dawn of Day", author: "Friedrich Nietzsche", year: "1881", difficulty: 4 },
      { id: 51935, title: "Human, All-Too-Human, Part 1", author: "Friedrich Nietzsche", year: "1878", difficulty: 4 },
      { id: 37841, title: "Human, All-Too-Human, Part 2", author: "Friedrich Nietzsche", year: "1880", difficulty: 4 },
      { id: 52914, title: "The Will to Power, Books I–II", author: "Friedrich Nietzsche", year: "1901", difficulty: 5, note: "Assembled from notebooks after his death — fragmentary by nature." },
      { id: 52915, title: "The Will to Power, Books III–IV", author: "Friedrich Nietzsche", year: "1901", difficulty: 5 },
      { id: 25012, title: "The Case of Wagner", author: "Friedrich Nietzsche", year: "1888", difficulty: 4 },
      { id: 51710, title: "Thoughts Out of Season, Part 1", author: "Friedrich Nietzsche", year: "1873", difficulty: 4 },
      { id: 38226, title: "Thoughts Out of Season, Part 2", author: "Friedrich Nietzsche", year: "1874", difficulty: 4 },
    ],
  },
  {
    author: "Leo Tolstoy",
    blurb:
      "The prose is plain. The problem is the cast — every character has three names and a title, and they rotate. This is what the tracker was built for.",
    books: [
      { id: 986, title: "Master and Man", author: "Leo Tolstoy", year: "1895", difficulty: 2, note: "A novella. Read it in one evening and see how the tools feel." },
      { id: 6157, title: "What Men Live By, and Other Tales", author: "Leo Tolstoy", year: "1885", difficulty: 2 },
      { id: 689, title: "The Kreutzer Sonata and Other Stories", author: "Leo Tolstoy", year: "1889", difficulty: 3 },
      { id: 985, title: "Father Sergius", author: "Leo Tolstoy", year: "1898", difficulty: 3 },
      { id: 1399, title: "Anna Karenina", author: "Leo Tolstoy", year: "1878", difficulty: 4, note: "Turn the character tracker on before chapter one. You will need it." },
      { id: 2600, title: "War and Peace", author: "Leo Tolstoy", year: "1869", difficulty: 5, note: "580 characters, four families, a war. Recaps are not optional here." },
      { id: 1938, title: "Resurrection", author: "Leo Tolstoy", year: "1899", difficulty: 4 },
      { id: 4761, title: "The Cossacks", author: "Leo Tolstoy", year: "1863", difficulty: 3 },
      { id: 2142, title: "Childhood", author: "Leo Tolstoy", year: "1852", difficulty: 2, note: "His first book. Start of the autobiographical trilogy." },
      { id: 2450, title: "Boyhood", author: "Leo Tolstoy", year: "1854", difficulty: 2 },
      { id: 2637, title: "Youth", author: "Leo Tolstoy", year: "1856", difficulty: 3 },
      { id: 47197, title: "Sevastopol", author: "Leo Tolstoy", year: "1855", difficulty: 3 },
      { id: 41119, title: "A Russian Proprietor, and Other Stories", author: "Leo Tolstoy", year: "1856", difficulty: 3 },
      { id: 67224, title: "The Devil", author: "Leo Tolstoy", year: "1889", difficulty: 3 },
      { id: 4602, title: "The Kingdom of God Is Within You", author: "Leo Tolstoy", year: "1894", difficulty: 4 },
      { id: 64908, title: "What Is Art?", author: "Leo Tolstoy", year: "1897", difficulty: 4 },
      { id: 43794, title: "My Religion", author: "Leo Tolstoy", year: "1884", difficulty: 4 },
    ],
  },
  {
    author: "The Brontë Sisters",
    blurb:
      "Dense interiority and a lot of unmarked irony. The narrator is often not telling you the truth, and the plain-English pass will say so.",
    books: [
      { id: 1260, title: "Jane Eyre", author: "Charlotte Brontë", year: "1847", difficulty: 3, note: "The most readable of the six. A good place to begin." },
      { id: 768, title: "Wuthering Heights", author: "Emily Brontë", year: "1847", difficulty: 5, note: "Nested narrators, two generations, everyone named Catherine or Heathcliff." },
      { id: 969, title: "The Tenant of Wildfell Hall", author: "Anne Brontë", year: "1848", difficulty: 3 },
      { id: 767, title: "Agnes Grey", author: "Anne Brontë", year: "1847", difficulty: 2, note: "Short and clear. The easiest Brontë by a distance." },
      { id: 9182, title: "Villette", author: "Charlotte Brontë", year: "1853", difficulty: 4, note: "Long stretches of untranslated French — tap them and they resolve." },
      { id: 1028, title: "The Professor", author: "Charlotte Brontë", year: "1857", difficulty: 3 },
      { id: 1019, title: "Poems by Currer, Ellis, and Acton Bell", author: "The Brontë Sisters", year: "1846", difficulty: 3 },
    ],
  },
];

export const ALL_BOOKS: ShelfBook[] = SHELVES.flatMap((s) => s.books);

export function findBook(id: number): ShelfBook | undefined {
  return ALL_BOOKS.find((b) => b.id === id);
}
