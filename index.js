require('dotenv').config()
const { ApolloServer, gql, UserInputError, AuthenticationError } = require('apollo-server')
const { GraphQLError } = require('graphql')
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')
const Author = require('./models/author')
const Book = require('./models/book')
const User = require('./models/user')



const url = process.env.MONGODB_URI
mongoose.set('strictQuery', false)

const JWT_SECRET = 'NEED_HERE_A_SECRET_KEY'

console.log('connecting to', url)

mongoose.connect(url)
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch((error) => {
    console.log('error connection to MongoDB:', error.message)
  })

const typeDefs = gql`
  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]!
    id: ID!
  }

  type Author {
    name: String!
    id: ID!
    born: Int
    bookCount: Int
  }

  type Query {
    bookCount: Int
    authorCount: Int
    allBooks(author: String, genre: String): [Book]
    allAuthors: [Author]
    me: User
    genres: [String]
  }

  type Mutation {
    addBook(
      title: String!
      author: String!
      published: Int!
      genres: [String!]!
    ): Book!
    editAuthor(name: String!, setBornTo: Int!): Author
    createUser(
      username: String!
      favoriteGenre: String!
    ): User
    login(
      username: String!
      password: String!
    ): Token
    removeBooks: Int
    removeAuthors: Int
  }
`

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
    allAuthors: async () => Author.find({}),
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
      const books = await Book.find({ author:  root._id })
      return books.length
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
  
      return { value: jwt.sign(userForToken, JWT_SECRET) }
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    const auth = req ? req.headers.authorization : null
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      const decodedToken = jwt.verify(
        auth.substring(7), JWT_SECRET
      )

      const currentUser = await User
        .findById(decodedToken.id)
      return { currentUser }
    }
  }
})

server.listen().then(({ url }) => {
  console.log(`Server ready at ${url}`)
})