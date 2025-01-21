import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

type Room = {
  roomId: string;
  roomName: string;
};

type User = {
  userId: string;
  userName: string;
  roomId: string;
};

type GroupMessage = {
  userName: string;
  roomId: string;
  message: string;
};

@WebSocketGateway({
  namespace: 'events',
})
export class ChatGateway {
  private rooms: Map<string, Room>;
  private users: Map<string, User[]>;
  private groupMessages: Map<string, GroupMessage[]>;

  constructor() {
    this.rooms = new Map();
    this.users = new Map();
  }

  @WebSocketServer()
  server: Server;

  /**
   * Create a new room
   */
  @SubscribeMessage('createRoom')
  createRoom(
    @MessageBody() data: { roomName: string },
    @ConnectedSocket() client: Socket,
  ) {
    const roomId = `room${Date.now()}`;

    const room: Room = {
      roomId,
      roomName: data.roomName,
    };

    this.rooms.set(roomId, room);

    client.join(roomId);

    // Notify the client that the room is created
    client.emit('roomCreated', room);

    // Notify all clients about the updated room list
    this.server.emit('rooms', Array.from(this.rooms.values()));

    console.log(`Room created: ${roomId} (${data.roomName})`);
  }

  /**
   * Join an existing room
   */
  @SubscribeMessage('joinRoom')
  joinRoom(
    @MessageBody() data: { userName: string; roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { userName, roomId } = data;

    if (!this.rooms.has(roomId)) {
      client.emit('error', `Room ${roomId} does not exist`);
      return;
    }

    const usersInRoom = this.users.get(roomId) || [];
    const userExists = usersInRoom.some((user) => user.userName === userName);

    if (userExists) {
      client.emit('error', `User ${userName} already exists in room ${roomId}`);
      return;
    }

    const user: User = {
      userId: client.id,
      userName,
      roomId,
    };

    usersInRoom.push(user);
    this.users.set(roomId, usersInRoom);

    client.join(roomId);

    // Notify the client that they joined the room
    client.emit('joinedRoom', `Successfully joined room: ${roomId}`);

    // Notify other members in the room
    client.to(roomId).emit('userJoined', `${userName} has joined the room`);

    // Broadcast the updated user list in the room
    this.server.to(roomId).emit('totalUsers', usersInRoom);

    console.log(`User ${userName} (${client.id}) joined room ${roomId}`);
  }

  /**
   * Delete a Room
   */
  @SubscribeMessage('deleteRoom')
  deleteRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId } = data;

    if (!this.rooms.has(roomId)) {
      client.emit('error', `Room ${roomId} does not exist`);
      return;
    }

    this.server
      .to(roomId)
      .emit('roomDeleted', { message: `Room ${roomId} has been deleted.` });

    this.rooms.delete(roomId);
    this.users.delete(roomId);
    // Notify all clients about the updated room list
    this.server.emit('rooms', Array.from(this.rooms.values()));

    console.log(`Room deleted: ${roomId}`);
  }

  /**
   * Send a message to a room
   */
  @SubscribeMessage('sendMessage')
  sendMessage(
    @MessageBody() data: GroupMessage,
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, message, userName } = data;

    if (!this.rooms.has(roomId)) {
      client.emit('error', `Room ${roomId} does not exist`);
      return;
    }

    this.server.to(roomId).emit('newMessage', { userId: userName, message });

    console.log(`Message sent to room ${roomId}: ${message}`);
  }

  @SubscribeMessage('leaveRoom')
  leaveRoom(
    @MessageBody() data: { roomId: string; userName: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, userName } = data;

    if (!this.rooms.has(roomId)) {
      client.emit('error', `Room ${roomId} does not exist`);
      return;
    }

    // Remove the user from the room
    const usersInRoom = this.users.get(roomId) || [];
    const updatedUsers = usersInRoom.filter(
      (user) => user.userId !== client.id,
    );
    this.users.set(roomId, updatedUsers);

    // Notify other users in the room
    client.to(roomId).emit('userLeft', `${userName} has left the room`);

    this.server.to(roomId).emit('totalUsers', usersInRoom);

    console.log(`User ${userName} (${client.id}) left room ${roomId}`);
  }

  /**
   * Disconnect handler
   */
  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);

    // Remove user from the rooms they joined
    this.users.forEach((usersInRoom, roomId) => {
      const updatedUsers = usersInRoom.filter(
        (user) => user.userId !== client.id,
      );

      if (updatedUsers.length > 0) {
        this.users.set(roomId, updatedUsers);
        this.server.to(roomId).emit('totalUsers', updatedUsers);
      } else {
        this.users.delete(roomId);
      }
    });
  }

  @SubscribeMessage('fetchRooms')
  triggerFetchAvailableRooms() {
    console.log(this.rooms);
    this.server.emit('getRooms', Array.from(this.rooms.values()));
  }
}
