// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VesselSettlement
/// @notice Testnet settlement vault for Vessel EVM wallets.
/// @dev Vessel verifies the Ed25519 quote signature server-side after reading this receipt.
contract VesselSettlement {
    uint8 public constant VESSEL_CHAIN_EVM = 3;
    uint32 public constant SEPOLIA_CHAIN_ID = 11155111;
    bytes32 public constant ACCEPTED_ASSET =
        0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee;

    struct QuoteV1 {
        uint8 version;
        uint8 chain;
        uint32 network;
        bytes32 quoteId;
        bytes32 payer;
        bytes32 storageAddress;
        bytes32 asset;
        uint64 amount;
        bytes32 fileHash;
        uint16 retentionDays;
        uint64 storageExpirationMicros;
        uint64 quoteExpiresAtSecs;
        uint64 configVersion;
    }

    address public owner;
    address public pendingOwner;
    bool public upgradesLocked;

    event SettlementReceiptV1(
        uint8 chain,
        uint32 network,
        bytes32 quoteId,
        bytes32 payer,
        bytes32 storageAddress,
        bytes32 asset,
        uint64 amount,
        bytes32 fileHash,
        uint64 storageExpirationMicros,
        uint64 configVersion
    );
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event UpgradesLocked();
    event Withdrawal(address indexed to, uint256 amount);

    error Unauthorized();
    error InvalidOwner();
    error InvalidQuote();
    error InvalidPayment();
    error ExpiredQuote();
    error UpgradeLocked();
    error WithdrawalFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidOwner();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function settle(QuoteV1 calldata quote, bytes calldata signature) external payable {
        if (
            quote.version != 1 ||
            quote.chain != VESSEL_CHAIN_EVM ||
            quote.network != SEPOLIA_CHAIN_ID ||
            quote.payer != bytes32(uint256(uint160(msg.sender))) ||
            quote.asset != ACCEPTED_ASSET ||
            quote.amount == 0 ||
            quote.fileHash == bytes32(0) ||
            quote.storageAddress == bytes32(0) ||
            quote.quoteId == bytes32(0) ||
            quote.retentionDays == 0 ||
            signature.length == 0
        ) {
            revert InvalidQuote();
        }
        if (msg.value != uint256(quote.amount)) revert InvalidPayment();
        if (block.timestamp > uint256(quote.quoteExpiresAtSecs)) revert ExpiredQuote();

        emit SettlementReceiptV1(
            quote.chain,
            quote.network,
            quote.quoteId,
            quote.payer,
            quote.storageAddress,
            quote.asset,
            quote.amount,
            quote.fileHash,
            quote.storageExpirationMicros,
            quote.configVersion
        );
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (upgradesLocked) revert UpgradeLocked();
        if (nextOwner == address(0)) revert InvalidOwner();
        pendingOwner = nextOwner;
        emit OwnershipTransferStarted(owner, nextOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }

    function lockUpgradesForever() external onlyOwner {
        upgradesLocked = true;
        emit UpgradesLocked();
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidOwner();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawalFailed();
        emit Withdrawal(to, amount);
    }

    receive() external payable {}
}

