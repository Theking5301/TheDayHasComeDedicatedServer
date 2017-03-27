var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var util = require('util');

var PlayerToSocketMap = [];

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', function(socket){
	//track connected clients via log
	var clientIp = socket.request.connection.remoteAddress;
	var clientPort = socket.request.connection.remotePort;
	var clientConnectedMsg = 'User connected ' + clientIp + ':' + clientPort;
	io.emit('SERVER_MAINTENANCE', clientConnectedMsg);
	OutputToLog(clientConnectedMsg);

	//Log Player Connecting. Initialize.
	socket.on('PLAYER_CONNECTED', function(msg){
		PlayerConnected(socket, msg);
	})
	//Log Player Disconnected. Perform Cleanup.
	socket.on('disconnect', function(){
		PlayerDisconnected(socket);
	})
	socket.on('CREATE_LOBBY', function(msg){
		CreateLobby(socket, msg);
	})
	socket.on('JOIN_LOBBY', function(msg){
		JoinLobby(socket, msg);
	})
	socket.on('LEAVE_LOBBY', function(msg){
		GracefullyLeaveLobby(socket, msg);
	})
	socket.on('UPDATE_PLAYER_STATE_IN_LOBBY', function(msg){
		UpdatePlayerStateInLobby(socket, msg);
	})
	socket.on('UPDATE_LOBBY', function(msg){
		UpdateLobby(socket, msg);
	})
	socket.on('REQUEST_LOBBY_UPDATE', function(msg){
		HandleLobbyUpdateRequest(socket, msg);
	})
	socket.on('REQUEST_CLIENT_INFORMATION', function(msg){
		ProvideClientInformation(socket, msg);
	})
	//multicast received message from client
	socket.on('CHAT_MESSAGE', function(msg){
		OnChatMessageRecieved(msg)
	});
});

http.listen(7777, "0.0.0.0", function(){
	OutputToLog('[THE DAY HAS COME -- SERVER LAUNCHED]');
  	OutputToLog('Listening on port 7777...');
})
function OnChatMessageRecieved(SignedJSON) {
	var tempJSON = JSON.parse(SignedJSON);
	var tempPayload = tempJSON.PAYLOAD;
	
	io.emit('CHAT_MESSAGE_RECIEVED', SignedJSON);
	OutputToLog(tempJSON.PLAYER_NAME + ' said: ' + tempPayload.MESSAGE);
}
function CreateLobby(Socket, SignedJSON) {
	var tempJSON = JSON.parse(SignedJSON);
	var tempPayload = tempJSON.PAYLOAD;
		
	if(io.sockets.adapter.rooms[tempPayload.UNIQUE_ROOM_NAME]) {
		OutputToLog('CREATE_LOBBY: ' + tempJSON.PLAYER_NAME + ' tried to create a room that already exists.');
		return;
	}

	Socket.join(tempPayload.UNIQUE_ROOM_NAME);
	io.to(Socket.id).emit('HOST_STATUS', 'ROOM ' + tempPayload.ROOM_NAME + ' CREATED');
	OutputToLog('CREATE_LOBBY: Lobby ' + tempPayload.ROOM_NAME + ' Created By: ' + tempJSON.PLAYER_NAME);
}
function JoinLobby(Socket, SignedJSON) {
	var tempJSON = JSON.parse(SignedJSON);
	var tempPayload = tempJSON.PAYLOAD;
	var tempLobbyInfo = tempPayload.LOBBY_TO_JOIN;

	var roomName = tempLobbyInfo.ROOM_NAME;
	var uniqueRoomName = tempLobbyInfo.UNIQUE_ROOM_NAME;
	
	var room = io.sockets.adapter.rooms[uniqueRoomName];
	if(room) {
		for (var id in room) {
			if(id == Socket.id) {
				OutputToLog('JOIN_LOBBY: ' + tempJSON.PLAYER_NAME + ' is already in the room: ' + roomName);
				return;
			}
		}
	}
	Socket.join(uniqueRoomName);
	io.to(GetRoomHost(Socket, uniqueRoomName, tempLobbyInfo)).emit('PLAYER_JOINED_LOBBY', SignedJSON);
	io.to(Socket.id).emit('JOIN_ALLOWED', SignedJSON);
	OutputToLog('JOIN_LOBBY: ' + tempJSON.PLAYER_NAME + ' joined room ' + roomName);
}
function AbruptlyLeaveLobby(Socket, Room) {
	Socket.leave(Room);
	var clientIp = Socket.request.connection.remoteAddress;
	var clientPort = Socket.request.connection.remotePort;
	OutputToLog('LEAVE_LOBBY: ' + tempJSON.PLAYER_NAME + ' crashed out of the room: ' + roomName);
}
function GracefullyLeaveLobby(Socket, SignedJSON) {
	var tempJSON = JSON.parse(SignedJSON);
	var tempPayload = tempJSON.PAYLOAD;
	var tempLobbyInfo = tempPayload.LOBBY_TO_LEAVE;
	var roomName = tempLobbyInfo.UNIQUE_ROOM_NAME;
		

	Socket.leave(roomName);
	OutputToLog('LEAVE_LOBBY: ' + tempJSON.PLAYER_NAME + ' left the room: ' + roomName);
	io.to(GetRoomHost(Socket, uniqueRoomName, tempLobbyInfo)).emit('PLAYER_LEFT_LOBBY', SignedJSON);
}
function UpdatePlayerStateInLobby(Socket, SignedJSON) {
	var tempJSON = JSON.parse(SignedJSON);
	var tempPayload = tempJSON.PAYLOAD;
	var tempLobbyInfo = tempPayload.CURRENT_LOBBY;

	var roomName = tempLobbyInfo.ROOM_NAME;
	var uniqueRoomName = tempLobbyInfo.UNIQUE_ROOM_NAME;
	var hostID = GetRoomHost(Socket, uniqueRoomName, tempLobbyInfo);

	io.to(hostID).emit('PLAYER_STATE_UPDATED', SignedJSON);
	OutputToLog('UPDATE_PLAYER_STATE_IN_LOBBY: ' + tempJSON.PLAYER_NAME + ' updated their state in room: ' + roomName);
}
function UpdateLobby(Socket, SignedJSON) {
	var tempJSON = JSON.parse(SignedJSON);
	var tempPayload = tempJSON.PAYLOAD;
	var lobbyinfo = tempPayload.LOBBY_SETTINGS;
	var uniqueRoomName = lobbyinfo.UNIQUE_ROOM_NAME;

	//Socket.broadcast.in(uniqueRoomName).emit('LOBBY_UPDATE', SignedJSON);
	BroadcastToRoom(uniqueRoomName, 'LOBBY_UPDATE', SignedJSON);
	OutputToLog('UPDATE_LOBBY: ' + tempJSON.PLAYER_NAME + ' updated the lobby for room: ' + uniqueRoomName);
}
function HandleLobbyUpdateRequest(Socket, SignedJSON) {
	var tempJSON = JSON.parse(SignedJSON);
	var tempPayload = tempJSON.PAYLOAD;
	var lobbyinfo = tempPayload.CURRENT_LOBBY;
	var uniqueRoomName = lobbyinfo.UNIQUE_ROOM_NAME;

	var tempID = GetRoomHost(Socket, uniqueRoomName, lobbyinfo);

	io.to(tempID).emit('LOBBY_UPDATE_REQUESTED', SignedJSON);
	OutputToLog('REQUEST_LOBBY_UPDATE: ' + tempJSON.PLAYER_NAME + ' requested a lobby update for room: ' + uniqueRoomName);
}
function PlayerConnected(Socket, SignedJSON) {
	var tempJSON = JSON.parse(SignedJSON);
	PlayerToSocketMap.push({
    	key:   tempJSON.PLAYER_ID,
    	value: Socket.id
	});
	ProvideClientInformation(Socket, SignedJSON);
	io.to(Socket.id).emit('CONNECTED_TO_SERVER', SignedJSON);
	SendChatMessage(Socket, 'Welcome!');
	OutputToLog('PLAYER_CONNECTED: ' + tempJSON.PLAYER_NAME + ' - TOTAL_LOAD: ' + PlayerToSocketMap.length);
}
function PlayerDisconnected(Socket) {
	var clientIp = Socket.request.connection.remoteAddress;
	var clientPort = Socket.request.connection.remotePort;

	for(var i=0; i<Socket.rooms.length; i++) {
		AbruptlyLeaveLobby(Socket, Socket.rooms.get(i));
	}

	for(var i=0; i<PlayerToSocketMap.length; i++) {
		if(PlayerToSocketMap[i].value == Socket.id) {
			PlayerToSocketMap.splice(i, 1);
			break;
		}
	}
	//OutputToLog('User disconnected ' + clientIp + ':' + clientPort + ' - TOTAL_LOAD: ' + PlayerToSocketMap.length-1);
		OutputToLog('User disconnected '  + ' - TOTAL_LOAD: ' + PlayerToSocketMap.length-1);
}
function ProvideClientInformation(Socket, SignedJSON) {
	var tempJSON = JSON.parse(SignedJSON);
	var clientIp = Socket.request.connection.remoteAddress;
	var clientPort = Socket.request.connection.remotePort;

	var requestJSON = {   
   		"IP" : clientIp,
		"PORT" : clientPort  
	};

	Socket.emit('CLIENT_INFORMATION_REQUEST_RESPONSE', JSON.stringify(requestJSON));
	OutputToLog('REQUEST_CLIENT_INFORMATION: ' + tempJSON.PLAYER_NAME + ' requested their client information.');
}

//Helper Functions
/**Output to the server log with a timestamp*/
function OutputToLog(Message) {
	var d = new Date().toTimeString(); 
	var time = d.substring(0, 8);
	console.log('<' + time + '> ' + Message);
}
/**Server helper fucntion to send chat messages to all clients in every room*/
function SendChatMessage(Socket, Message) {
	var time = new Date().toTimeString(); 
	var payload = {   
   		"COLOR" : '#ffa500',
		"MESSAGE" : Message,  
		"CHAT_CHANNEL" : 2  
	};
	var signedPacket = {   
   		"PLAYER_ID" : 'SERVER',
		"PLAYER_NAME" : 'SERVER',
		"TIME" : time,
		"PAYLOAD" : payload   
	};

	io.to(Socket.id).emit('CHAT_MESSAGE_RECIEVED', JSON.stringify(signedPacket));
}
/**Returns the Steam ID of a player given a Socket ID*/
function GetPlayerIDFromSocket(SocketID) {
	for(var i=0; i<PlayerToSocketMap.length; i++) {
		if(PlayerToSocketMap[i].value == SocketID) {
			return PlayerToSocketMap[i].key;
		}
	}
}
/**Returns the socket ID of a specific player given their Steam ID*/
function GetSocketFromPlayer(PlayerID) {
	for(var i=0; i<PlayerToSocketMap.length; i++) {
		if(PlayerToSocketMap[i].key == PlayerID) {
			return PlayerToSocketMap[i].value;
		}
	}
}
/**Get the lobby host for a specific room.*/
function GetRoomHost(RequestingSocket, RoomName, LobbyInfo) {
	var clients = io.sockets.adapter.rooms[RoomName].sockets;   

	if(clients) {
		for (var clientId in clients ) {
			var clientSocket = io.sockets.connected[clientId];
			if(clientSocket.id == GetSocketFromPlayer(LobbyInfo.HOST_ID)) {
				return clientSocket.id;
			}
		}
	}
	return -1;
}
/**Send a message to all members on a room on a specific channel.*/
function BroadcastToRoom(RoomName, Channel, SignedJSON) {
	var clients = io.sockets.adapter.rooms[RoomName].sockets;   

	if(clients) {
		for (var clientId in clients ) {
			var clientSocket = io.sockets.connected[clientId];
			io.to(clientSocket.id).emit(Channel, SignedJSON);
		}
	}
}