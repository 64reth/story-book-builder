import { books, createBook, saveBook } from "../src/lib/repository";
if (process.argv[2] === "write") {
  const book = createBook("Restart test", "", 32);
  saveBook({
    ...book,
    pages: book.pages.map((p) => ({ ...p, text: "persisted manuscript" })),
  });
} else process.stdout.write(books()[0].pages[0].text);
