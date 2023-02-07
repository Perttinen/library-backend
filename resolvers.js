const { GraphQLError } = require('graphql')
const jwt = require('jsonwebtoken')

const Author = require('./models/author')
const Book = require('./models/book')
const User = require('./models/user')
const { PubSub } = require('graphql-subscriptions')
const pubsub = new PubSub()

const resolvers = {
    Query: {  
      bookCount: async () => Book.collection.countDocuments(),
      authorCount: async () => Author.countDocuments(),
      allBooks: async (root, args) => {
        let books = await Book.find({}).populate('author')
        
        if(args.author){
          const [auth] = await Author.find({"name": args.author})
          books = books.filter(b => b.author.equals(auth._id))
        }
        if(args.genre){
          books = books.filter(b => b.genres.includes(args.genre))
        }
        return books
      },
      allAuthors: async () => Author.find({}).populate('books'),
      me: async (root, args, context) => {
        return context.currentUser
      },
      genres: async () => {
        let genres = []
        const books = await Book.find({})
        books.forEach(b => genres = genres.concat(b.genres))
        genres = [...new Set(genres)]
        return genres
      }
    },
    Author: {
      bookCount: async (root) => {
        return root.books.length
      }
    },
    Mutation: {    
      addBook: async (root,args, context) => {
        const currentUser = context.currentUser
        if(!currentUser){
          throw new AuthenticationError('not authenticated')
        }
        let newAuthor = false
        let bookAuthor = await Author.findOne({"name": args.author})
        if(!bookAuthor){
          try{
          bookAuthor = await new Author({"name": args.author}).save()
          newAuthor = true
          }catch(error){
            throw new UserInputError(error.message, {
              invalidArgs: args,
            })
          }
        }
        const book = new Book({...args, author:bookAuthor._id})

        bookAuthor.books = bookAuthor.books.concat(book._id)
        bookAuthor.save()

        try{
          await book.save()
        } catch(error){
          if(newAuthor){
            await Author.deleteOne(bookAuthor)
          }
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        }

        pubsub.publish('BOOK_ADDED', { bookAdded: book.populate('author') })

        return book.populate('author')
      },
      editAuthor: async (root,args, context) => {
        const currentUser = context.currentUser
        if(!currentUser){
          throw new AuthenticationError('not authenticated')
        }
        const authorToEdit = await Author.findOne({name: args.name})
        if(!authorToEdit) return null
        return Author.findOneAndUpdate({name: authorToEdit.name},{born: args.setBornTo}, {new:true} )
      },
      removeBooks: async () => {
        Book.collection.deleteMany({})
        return 666
      },
      removeAuthors: async () => {
        Author.collection.deleteMany({})
        return 666
      },
      createUser: async (root, args) => {
        const user = new User({username: args.username, favoriteGenre: args.favoriteGenre})
        return user.save()
          .catch(error => {
            throw new UserInputError(error.message, {
              invalidArgs: args,
            })
          })
      },
      login: async (root,args) => {
        const user = await User.findOne({ username: args.username })
        if ( !user || args.password !== 'secret' ) {
          throw new UserInputError("wrong credentials")
        }
    
        const userForToken = {
          username: user.username,
          id: user._id,
        }
    
        return { value: jwt.sign(userForToken, process.env.JWT_SECRET) }
      }
    },
    Subscription: {
        bookAdded: {
          subscribe: () => pubsub.asyncIterator('BOOK_ADDED')
        },
    },
  }

  module.exports = resolvers