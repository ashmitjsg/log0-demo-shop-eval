//! The stock book: what is available, and which order holds what. Plain data, no I/O: easy to test.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Line {
    pub sku: String,
    pub qty: u32,
}

#[derive(Debug, PartialEq)]
pub enum ReserveError {
    /// Not enough of this SKU, or the SKU is not stocked at all.
    OutOfStock(String),
}

pub struct Stock {
    available: HashMap<String, u32>,
    reservations: HashMap<String, Vec<Line>>,
}

impl Stock {
    pub fn new(available: HashMap<String, u32>) -> Self {
        Stock { available, reservations: HashMap::new() }
    }

    /// The demo catalog: SKU-1001..SKU-1038 are stocked; SKU-1038 is nearly sold out. The two newest
    /// products in the storefront catalog (SKU-1039, SKU-1040) have not been stocked yet.
    pub fn seeded() -> Self {
        let mut available: HashMap<String, u32> = (1001..=1037).map(|n| (format!("SKU-{n}"), 1_000_000)).collect();
        available.insert("SKU-1038".to_string(), 3);
        Stock::new(available)
    }

    /// Reserve every line or none of them. Lines for the same SKU are added up first.
    pub fn reserve(&mut self, order_id: &str, lines: &[Line]) -> Result<(), ReserveError> {
        let mut needed: HashMap<&str, u32> = HashMap::new();
        for line in lines {
            let slot = needed.entry(line.sku.as_str()).or_insert(0);
            *slot = slot.saturating_add(line.qty);
        }
        for (sku, qty) in &needed {
            match self.available.get(*sku) {
                Some(have) if have >= qty => {}
                _ => return Err(ReserveError::OutOfStock(sku.to_string())),
            }
        }
        for (sku, qty) in needed {
            if let Some(have) = self.available.get_mut(sku) {
                *have -= qty;
            }
        }
        self.reservations.insert(order_id.to_string(), lines.to_vec());
        Ok(())
    }

    /// Give an order's stock back. False if the order held nothing.
    pub fn release(&mut self, order_id: &str) -> bool {
        match self.reservations.remove(order_id) {
            Some(lines) => {
                for line in lines {
                    *self.available.entry(line.sku).or_insert(0) += line.qty;
                }
                true
            }
            None => false,
        }
    }

    pub fn available(&self, sku: &str) -> Option<u32> {
        self.available.get(sku).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(sku: &str, qty: u32) -> Line {
        Line { sku: sku.to_string(), qty }
    }

    fn stock() -> Stock {
        Stock::new(HashMap::from([("A".to_string(), 5), ("B".to_string(), 2)]))
    }

    #[test]
    fn reserving_takes_stock_and_releasing_gives_it_back() {
        let mut s = stock();
        assert_eq!(s.reserve("o1", &[line("A", 3)]), Ok(()));
        assert_eq!(s.available("A"), Some(2));
        assert!(s.release("o1"));
        assert_eq!(s.available("A"), Some(5));
        assert!(!s.release("o1"), "a second release changes nothing");
    }

    #[test]
    fn all_or_nothing() {
        let mut s = stock();
        assert_eq!(s.reserve("o1", &[line("A", 1), line("B", 9)]), Err(ReserveError::OutOfStock("B".into())));
        assert_eq!(s.available("A"), Some(5), "A was not touched");
    }

    #[test]
    fn an_unknown_sku_is_out_of_stock_not_a_crash() {
        let mut s = stock();
        assert_eq!(s.reserve("o1", &[line("NOPE", 1)]), Err(ReserveError::OutOfStock("NOPE".into())));
    }

    #[test]
    fn the_same_sku_twice_is_added_up() {
        let mut s = stock();
        assert_eq!(s.reserve("o1", &[line("B", 2), line("B", 1)]), Err(ReserveError::OutOfStock("B".into())));
        assert_eq!(s.available("B"), Some(2));
    }

    #[test]
    fn huge_quantities_do_not_overflow() {
        let mut s = stock();
        assert!(s.reserve("o1", &[line("A", u32::MAX), line("A", u32::MAX)]).is_err());
    }

    #[test]
    fn the_seeded_catalog_leaves_the_newest_products_unstocked() {
        let s = Stock::seeded();
        assert_eq!(s.available("SKU-1001"), Some(1_000_000));
        assert_eq!(s.available("SKU-1038"), Some(3));
        assert_eq!(s.available("SKU-1039"), None);
    }
}
