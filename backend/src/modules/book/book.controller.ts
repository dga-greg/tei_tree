import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { bookRequestBody, type BookService } from './book.service.js';

export class BookController {
  constructor(private readonly books: BookService) {}

  list = async (req: Request, res: Response) => {
    res.json({ data: await this.books.list(accessOf(req), actorOf(req)) });
  };

  get = async (req: Request, res: Response) => {
    res.json({ data: await this.books.get(accessOf(req), actorOf(req), parseIdParam(req.params['bookId'], 'Book')) });
  };

  create = async (req: Request, res: Response) => {
    res.status(202).json({ data: await this.books.request(accessOf(req), actorOf(req), parse(bookRequestBody, req.body)) });
  };

  remove = async (req: Request, res: Response) => {
    await this.books.remove(accessOf(req), actorOf(req), parseIdParam(req.params['bookId'], 'Book'));
    res.status(204).end();
  };

  /** Same-origin link that re-checks who is asking, then redirects to a short-lived signed file URL. */
  download = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, await this.books.downloadUrl(accessOf(req), actorOf(req), parseIdParam(req.params['bookId'], 'Book')));
  };
}
