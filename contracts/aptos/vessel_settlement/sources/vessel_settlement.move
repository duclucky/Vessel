module vessel_settlement::vessel_settlement {
    const VERSION: u8 = 1;

    #[view]
    public fun version(): u8 {
        VERSION
    }
}
