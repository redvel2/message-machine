'use strict'


let SimpleCrypto = {
    encrypt(message, key, blocksize) {
        let result = '', ch;
        for(let i=0;i<message.length;i++) {
            ch = message.charCodeAt(i);
            if(result.length >= blocksize) ch ^= result.charCodeAt(i-blocksize);
            ch ^= key.charCodeAt(i % key.length);
            result += String.fromCharCode(ch);
        }
        return result
    },
    decrypt(ctext, key, blocksize) {
        let result = '', ch;
        for(let i=0;i<ctext.length;i++) {
            ch = ctext.charCodeAt(i) ^ key.charCodeAt(i % key.length);
            if(result.length >= blocksize) ch ^= ctext.charCodeAt(i-blocksize);
            result += String.fromCharCode(ch);
        }
        return result
    }
}

let TardisContract = function () {
    LocalContractStorage.defineMapProperty(this, "messageArchive", {
        stringify: function (obj) {
            return JSON.stringify(obj)
        },
        parse: function (str) {
            return JSON.parse(str)
        }
    });
    LocalContractStorage.defineMapProperty(this, "idToMessageMap");
    LocalContractStorage.defineMapProperty(this, "addressToMessageMap");
    LocalContractStorage.defineMapProperty(this, "keyStorage");
    LocalContractStorage.defineMapProperty(this, "seed");    
    LocalContractStorage.defineProperty(this, "keyExpires");
    LocalContractStorage.defineProperty(this, "cryptBlockSize")
    
}

TardisContract.prototype = {
    init: function() {
        let randomInRange = function(min, max) {
            return Math.floor(Math.random() * (max - min)) + min;
        }
        this.messageArchive.set("index", []);
        this.keyExpires = 60*60*24 // new key expires in 1 day
        this.seed.set("data", [randomInRange(10**10, 10**11 - 1), randomInRange(10**10, 10**11 - 1)])
        this.cryptBlockSize = 5;
    },

    _decryptMessage: function(message){
        let key = this.keyStorage.get(Blockchain.transaction.from);
        let now = new Date().getTime()
        if (key === null || key.expires < now) throw new Error('Generate encryption key first');
        return SimpleCrypto.decrypt(message, key.value, this.cryptBlockSize)
    },

    _random: function() {
        let seed = this.seed.get("data")
        let x = seed[0], y = seed[1];
        seed[0] = y;
        x ^= x << 23;
        seed[1] = x ^ y ^ (x >> 17) ^ (y >> 26);
        this.seed.set("data", seed)
        return seed[1] + y;

    },

    _generateKey(length) {
        let result = '';
        while(result.length<length) result += this._random().toString(36)
        return result.substr(0, length - 1)
    },

    addMessage: function(message, releaseTs, private_) {
        private_ = private_ || false;
        let now = new Date().getTime();
        if (releaseTs < now) throw new Error('Incorrect release time');
        if(!message) throw new Error("Message can`t be empty");

        let archive = this.messageArchive.get("index");
        let sender = Blockchain.transaction.from;
        let userArchive = this.addressToMessageMap.get(sender);
        let newMessageId = Math.abs(this._random());
        let messageObj = {
            text: this._decryptMessage(message),
            releaseTs: releaseTs,
            sendTs: now,
            sender: sender,
            id: newMessageId,
            private: private_
        };
        archive.push(messageObj);
        userArchive = userArchive || [];
        userArchive.push(archive.length - 1); // creating db-like message index on user
        this.idToMessageMap.set(newMessageId, archive.length - 1);
        this.addressToMessageMap.set(sender, userArchive);
        this.messageArchive.set("index", archive);
        messageObj.text = message;
        messageObj.id = null; //nullify message id, because of private messages. To get message id use 'getLastMessageId' method
        return messageObj
    },

    getMessageById: function(id) {
        if(!id) throw new Error('Id can`t be empty');
        let messageId = this.idToMessageMap.get(id);
        if (messageId === null) return {};
        let archive = this.messageArchive.get("index");
        let message = archive[messageId];
        let now = new Date().getTime();
        if (message.releaseTs > now) message.text = ''
        return message
    },

    getLastMessageId: function() {
        let userArchive = this.addressToMessageMap.get(Blockchain.transaction.from);
        if (userArchive === null) return null;
        let archive = this.messageArchive.get("index");
        return archive[userArchive[userArchive.length - 1]].id
    },

    filterByAddress: function(address) {
        if(!address) throw new Error("Address can`t be empty");
        let userArchive = this.addressToMessageMap.get(address);
        let archive = this.messageArchive.get("index");
        let now = new Date().getTime();
        userArchive = userArchive || [];
        let result = userArchive.reverse().map(idx => {
            let message = archive[idx];
            if(message.releaseTs > now) message.text = '';
            return message
        })
        if(Blockchain.transaction.from!=address) result = result.filter((el) => !el.private);
        return result
    },

    getRecentMessages: function(cnt, ts){
        let archive = this.messageArchive.get("index");
        let now = new Date().getTime();
        let result = [];
        let message;
        for (let i = archive.length - 1; i>=0; i--) {
            message = archive[i]
            if(
                (message.private && Blockchain.transaction.from !== message.sender)
                    || (ts && message.releaseTs <= ts)) continue; // get all released messages after some timestamp
            if (archive[i].releaseTs <= now) result.push(message);
            if(result.length >= cnt) break;
        }
        return result
    },
    generateKey: function(keyLength,generateNew) {
        keyLength = (!keyLength) || (keyLength && keyLength>10000)? 1024: keyLength
        generateNew = generateNew || false;
        let oldKey = this.keyStorage.get(Blockchain.transaction.from);
        let now = new Date();
        if(generateNew || oldKey === null || (oldKey && oldKey.expires < now.getTime())) {
            now.setSeconds(this.keyExpires);
            let key = {value: this._generateKey(keyLength), expires: now.getTime()};
            this.keyStorage.set(Blockchain.transaction.from, key);
        };
        return true
    },

    getKey(){
        let now = new Date().getTime();
        let key = this.keyStorage.get(Blockchain.transaction.from)
        if(key !== null && key.expires>now) return key
        return {}
    },

    echo(){
        return Blockchain.transaction.from
    }
}
module.exports = TardisContract

